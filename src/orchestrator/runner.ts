import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import { costBreakdown, costSoFarUsd, resetCostUsd, runAgent } from "@/agents/client";
import { prisma } from "@/db/client";
import type { Language, Persona } from "@/core/types";
import { shutdownObservability } from "@/observability/langfuse";
import {
  materializeSession,
  peekMcqAnswer,
  startSession,
  submitAnswer,
  type AnswerResult,
  type QuestionPayload,
} from "./session";

// Phase 1 CLI harness. Drives a full assessment headless, before any UI exists.
//   npm run assess -- --role "Senior Android Engineer"
//   npm run assess -- --role "Backend Engineer" --auto 7      (auto-candidate)
//   MAX_QUESTIONS=6 npm run assess -- --role "..." --auto 5   (short test run)

interface Args {
  role: string;
  specialization?: string;
  candidateName?: string;
  persona?: Persona;
  language: Language;
  auto?: number; // simulate a candidate at this level (1-10)
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const role = get("--role");
  if (!role) {
    console.error('Missing --role. Example: --role "Senior Android Engineer"');
    process.exit(1);
  }
  const years = get("--years");
  const background = get("--background");
  const persona: Persona | undefined =
    years || background
      ? { years: years ? Number(years) : undefined, background }
      : undefined;
  const auto = get("--auto");
  const language = (get("--language") as Language) ?? "en";
  return {
    role,
    specialization: get("--specialization"),
    candidateName: get("--name"),
    persona,
    language,
    auto: auto ? Number(auto) : undefined,
  };
}

const CandidateSchema = z.object({ answer: z.string() });

// A synthetic candidate answering AT a target level, so a full session can run
// unattended for the gate. This is a test/dev driver, not a product agent.
async function autoAnswer(
  role: string,
  question: QuestionPayload,
  level: number,
  language: Language,
): Promise<string> {
  const res = await runAgent({
    agent: "sim-candidate",
    model: "sonnet",
    system: [
      "You simulate a job candidate answering a skill-assessment question at a SPECIFIC level.",
      "A level-2 answer is shallow with clear gaps. A level-5 answer is competent but not deep.",
      "A level-8 answer is precise, covers trade-offs, and shows real depth. Answer AT the given level, no higher, no lower.",
      "Write only the answer as plain prose.",
    ].join("\n"),
    user: [
      `Role: ${role}`,
      `Target level: ${level} of 10`,
      `Question: ${question.text}`,
      language === "ar" ? "Answer in Arabic." : "Answer in English.",
    ].join("\n\n"),
    schema: CandidateSchema,
    // Roomy: a simulated senior answer to a written opener can be long, and the
    // whole simulation aborts if the candidate overflows its own output cap.
    maxOutputTokens: 3000,
    maxBudgetUsd: 0.3,
  });
  return res.data.answer;
}

function printQuestion(q: QuestionPayload): void {
  const probe = q.ceilingProbe ? "  [ceiling probe]" : "";
  const kind = q.format === "mcq" ? " (MCQ)" : "";
  console.log(`\n─ Q${q.order} · ${q.topicName} · level ${q.difficulty}${kind}${probe}`);
  console.log(q.text);
  if (q.format === "mcq" && q.options) {
    q.options.forEach((o, i) => console.log(`   ${i}) ${o}`));
  }
}

// Produce the answer for the current question. MCQ answers are a 0-based option
// index (as a string); text answers are prose. In auto mode an MCQ is answered
// by peeking the correct index (harness only): a candidate of the target level
// answers correctly when the question is at or below their level, else guesses.
async function getAnswer(
  args: Args,
  current: QuestionPayload,
  rl: ReturnType<typeof createInterface> | null,
): Promise<string> {
  if (current.format === "mcq") {
    if (args.auto !== undefined) {
      const peek = await peekMcqAnswer(current.questionId);
      if (!peek) return "0";
      const choice =
        args.auto >= current.difficulty
          ? peek.correctIndex
          : (peek.correctIndex + 1) % peek.optionCount;
      console.log(`\n[auto L${args.auto}] chose option ${choice}`);
      return String(choice);
    }
    return (await rl!.question("\nYour choice (number): ")).trim();
  }

  if (args.auto !== undefined) {
    const a = await autoAnswer(args.role, current, args.auto, args.language);
    console.log(`\n[auto L${args.auto}] ${a.slice(0, 160)}${a.length > 160 ? "…" : ""}`);
    return a;
  }
  return (await rl!.question("\nYour answer: ")).trim();
}

// Per-agent token + cost breakdown for the run, so you can see where a session
// spends (which agent, how many tokens) without opening Langfuse. The "in" column
// is every input token the model saw, including cache reads/creation, so a heavily
// cached call does not misleadingly read as ~0 input.
function printSpend(): void {
  const rows = costBreakdown();
  if (rows.length === 0) return;
  const seenIn = (r: (typeof rows)[number]) =>
    r.inputTokens + r.cacheReadTokens + r.cacheCreationTokens;
  let totalIn = 0;
  let totalOut = 0;
  for (const r of rows) {
    totalIn += seenIn(r);
    totalOut += r.outputTokens;
  }
  console.log("\n──────── SPEND (per agent) ────────");
  console.log(
    `${"agent".padEnd(18)}${"calls".padStart(6)}${"in".padStart(9)}${"out".padStart(9)}${"cost".padStart(10)}`,
  );
  for (const r of rows) {
    console.log(
      `${r.agent.padEnd(18)}${String(r.calls).padStart(6)}${String(seenIn(r)).padStart(9)}${String(r.outputTokens).padStart(9)}${("$" + r.costUsd.toFixed(4)).padStart(10)}`,
    );
  }
  console.log(
    `${"TOTAL".padEnd(18)}${"".padStart(6)}${String(totalIn).padStart(9)}${String(totalOut).padStart(9)}${("$" + costSoFarUsd().toFixed(4)).padStart(10)}`,
  );
}

async function main(): Promise<void> {
  resetCostUsd();
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  console.log(`\nStarting assessment for: ${args.role}`);
  const start = await startSession({
    role: args.role,
    specialization: args.specialization,
    candidateName: args.candidateName,
    persona: args.persona,
    language: args.language,
  });
  if (!start.ok) {
    console.error(`Could not start: ${start.reason}`);
    process.exit(1);
  }

  // Build the real topics + MCQ bank in the background (a no-op for pre-seeded
  // roles). The CLI process stays alive through the answer loop, so it finishes
  // without blocking the first question, mirroring the web app's after() scheduling.
  // submitAnswer also awaits ensureBlueprint as a safety net on the first submit.
  void materializeSession(start.sessionId);

  const rl =
    args.auto === undefined
      ? createInterface({ input: process.stdin, output: process.stdout })
      : null;

  let current: QuestionPayload = start.question;
  printQuestion(current);

  // Drive the loop until the engine reports done. One failed grade or agent call
  // must not kill a 25-question run: retry the question once, then stop
  // gracefully. Every answer is persisted server-side before grading, so nothing
  // typed is lost and the session state stays resumable.
  let bailed = false;
  for (;;) {
    let answer: string | undefined;
    let result: AnswerResult | undefined;
    for (let attempt = 1; attempt <= 2 && result === undefined; attempt++) {
      try {
        // Keep the first collected answer across the retry so a human is not
        // asked to retype (and the auto-candidate is not re-spawned) when only
        // the submit failed.
        answer = answer ?? (await getAnswer(args, current, rl));
        result = await submitAnswer({
          sessionId: start.sessionId,
          questionId: current.questionId,
          answer,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `\n[warn] Q${current.order} failed (${msg}).${attempt < 2 ? " Retrying once..." : ""}`,
        );
      }
    }
    if (result === undefined) {
      // Skip forward gracefully: the answer (if collected) is already stored, so
      // ending the loop keeps the shutdown path (spend, traces, DB) intact and
      // the session can be continued later from its persisted state.
      console.error(
        `\nCould not get past Q${current.order} after a retry. Progress is saved under session ${start.sessionId}; try again later.`,
      );
      bailed = true;
      break;
    }

    console.log(
      `  grade: ${result.grade.score}/100 · demonstrated level ${result.grade.demonstratedLevel}`,
    );

    if (result.done) {
      const r = result.report;
      console.log("\n══════════ RESULT ══════════");
      console.log(`Overall: ${r.total} / 1000  (± ${r.confidenceInterval})  ·  ${r.overallLabel}`);
      for (const t of r.topics) {
        console.log(`  ${t.points.toString().padStart(4)} / 1000  ${t.name}  (level ${t.theta.toFixed(1)}, ${t.label})`);
      }
      if (r.candidateName) console.log(`For: ${r.candidateName}`);
      console.log(`\nVerdict: ${r.verdict}`);
      console.log(`Summary: ${r.summary}`);
      if (r.weakPoints.length > 0) {
        console.log("Weak points:");
        r.weakPoints.forEach((w) => console.log(`  - ${w.area}: ${w.issue}`));
      }
      console.log("Learning path:");
      r.learningPath.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
      break;
    }

    current = result.question;
    printQuestion(current);
  }

  rl?.close();
  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  printSpend();
  console.log(`\nSession id: ${start.sessionId}`);
  console.log(`Cost: $${costSoFarUsd().toFixed(4)} · Time: ${secs}s`);
  // Signal an incomplete run without process.exit(): setting exitCode lets the
  // process drain naturally after shutdown (see the note below on libuv).
  if (bailed) process.exitCode = 1;
  await shutdown();
  // Exit naturally now that the tracer + DB are closed. Calling process.exit()
  // here is what force-closed a native handle mid-flight and tripped the libuv
  // UV_HANDLE_CLOSING assertion (exit 127).
}

// Deliver the final Langfuse trace and close the DB connection before exiting, so
// the process does not force-close a native handle mid-flight (the libuv
// UV_HANDLE_CLOSING assertion that produced exit 127) and does not drop the
// reporter trace.
async function shutdown(): Promise<void> {
  await shutdownObservability();
  try {
    await prisma.$disconnect();
  } catch {
    // best-effort
  }
}

main().catch(async (err) => {
  console.error("Runner failed:", err);
  await shutdown();
  process.exit(1);
});
