import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import { costBreakdown, costSoFarUsd, resetCostUsd, runAgent } from "@/agents/client";
import { prisma } from "@/db/client";
import { bandName, levelToBand } from "@/core/signals";
import type { Language, Persona } from "@/core/types";
import { shutdownObservability } from "@/observability/langfuse";
import {
  DomainError,
  getSessionState,
  materializeSession,
  peekMcqAnswer,
  startSession,
  submitAnswer,
  type AnswerResult,
  type QuestionPayload,
  type SessionReport,
  type SessionStateResult,
} from "./session";

// Phase 1 CLI harness. Drives a full assessment headless, before any UI exists.
//   npm run assess -- --role "Senior Android Engineer"
//   npm run assess -- --role "Backend Engineer" --auto 7      (auto-candidate)
//   npm run assess -- --resume <sessionId>                    (continue a saved run)
//   MAX_QUESTIONS=6 npm run assess -- --role "..." --auto 5   (short test run)

interface Args {
  role: string;
  specialization?: string;
  candidateName?: string;
  persona?: Persona;
  language: Language;
  auto?: number; // simulate a candidate at this level (1-10)
  resume?: string; // continue an existing session from its persisted state
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const role = get("--role");
  const resume = get("--resume");
  // A resumed session already knows its role, so --role is only required for a
  // fresh start.
  if (!role && !resume) {
    console.error(
      'Missing --role. Example: --role "Senior Android Engineer" (or --resume <sessionId>)',
    );
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
    role: role ?? "",
    specialization: get("--specialization"),
    candidateName: get("--name"),
    persona,
    language,
    auto: auto ? Number(auto) : undefined,
    resume,
  };
}

const CandidateSchema = z.object({ answer: z.string() });

// Who is answering, at each band. Deliberately written as a PERSON with a career
// stage, not as a list of the signals the scanner looks for. Prompting the
// simulator with the instrument's own checklist would make a full-session run
// circular: it would emit the signals and the scanner would find them, proving
// nothing. The real validity evidence is the hand-written golden set
// (npm run validity:scan). This harness only answers "does a full session run,
// and does the score move with the candidate".
const CANDIDATE_PERSONAS: Record<number, string> = {
  1: "someone who has just started learning this. They half-remember terms from a tutorial, mix a few up, and answer the question they wish had been asked.",
  2: "a junior with about a year in. They know the happy path and can name the right tools, but have never had to debug this under pressure, so their answer stops at what to do and never reaches why.",
  3: "a solid mid-level engineer with a few years in. They understand how the thing works and can explain it, they have been burned once or twice so they know a gotcha, but they tend to describe options rather than commit to one.",
  4: "a senior engineer. They scope the question before answering, quantify what matters, name the approach they rejected and why, and mention how they would know it broke in production.",
  5: "a staff engineer. They question whether the stated problem is the real one, argue about what does NOT need to be built, name where their own advice stops working, and reach for a concrete incident from their own history.",
  6: "a principal engineer thinking at the level of several teams and several years, weighing organisational and business cost alongside the technical call.",
};

// A synthetic candidate answering as a person at a target band, so a full session
// can run unattended. Test and dev driver, never a product agent.
async function autoAnswer(
  role: string,
  question: QuestionPayload,
  level: number,
  language: Language,
): Promise<string> {
  const band = levelToBand(level);
  const res = await runAgent({
    agent: "sim-candidate",
    model: "sonnet",
    system: [
      "You are role-playing a real engineer answering an interview question. Answer exactly as this person would, including what they would NOT think to say.",
      `You are ${CANDIDATE_PERSONAS[band] ?? CANDIDATE_PERSONAS[3]}`,
      "Do not perform. Do not write a model answer. Write what this specific person types into a text box in a couple of minutes, with their own habits and their own blind spots.",
      "Write only the answer, as plain prose. No headings, no bullet scaffolding unless this person would naturally use it.",
    ].join("\n"),
    user: [
      `Role being assessed: ${role}`,
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
  const kind = q.format === "mcq" ? " (MCQ)" : q.intent ? ` (${q.intent})` : "";
  console.log(`\n─ Q${q.order} · ${q.topicName} · level ${q.difficulty}${kind}${probe}`);
  console.log(q.text);
  if (q.format === "mcq" && q.options) {
    q.options.forEach((o, i) => console.log(`   ${i}) ${o}`));
  }
}

// Print the final report. Used by the normal finish path and by --resume when
// the session already ended (the stored report is served, nothing re-runs).
function printReport(r: SessionReport): void {
  console.log("\n══════════ RESULT ══════════");
  console.log(`Overall: ${r.total} / 1000  (± ${r.confidenceInterval})  ·  ${r.overallLabel}`);
  for (const t of r.topics) {
    // A topic's points are out of its OWN importance share, never out of 1000
    // (same phrasing rule as the reporter agent).
    const share =
      t.importance > 0
        ? `${t.points.toString().padStart(4)} of ${t.importance}`
        : "not assessed".padStart(12);
    console.log(`  ${share}  ${t.name}  (level ${t.theta.toFixed(1)}, ${t.label})`);
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
    `${"agent".padEnd(24)}${"calls".padStart(6)}${"in".padStart(9)}${"out".padStart(9)}${"cost".padStart(10)}${"s/call".padStart(9)}`,
  );
  for (const r of rows) {
    const perCall = r.calls > 0 ? (r.durationMs / r.calls / 1000).toFixed(1) : "0.0";
    console.log(
      `${r.agent.padEnd(24)}${String(r.calls).padStart(6)}${String(seenIn(r)).padStart(9)}${String(r.outputTokens).padStart(9)}${("$" + r.costUsd.toFixed(4)).padStart(10)}${perCall.padStart(9)}`,
    );
  }
  console.log(
    `${"TOTAL".padEnd(24)}${"".padStart(6)}${String(totalIn).padStart(9)}${String(totalOut).padStart(9)}${("$" + costSoFarUsd().toFixed(4)).padStart(10)}`,
  );
}

// Load the resume snapshot for --resume and report anything that ends the run
// here (finished session, missing session, mid-flight grade). Returns the open
// question to continue from, or null when there is nothing left to drive.
async function loadResume(sessionId: string, args: Args): Promise<QuestionPayload | null> {
  let state: SessionStateResult;
  try {
    state = await getSessionState(sessionId);
  } catch (err) {
    if (err instanceof DomainError && err.code === "session_not_found") {
      console.error(`No session found with id ${sessionId}.`);
      process.exitCode = 1;
      return null;
    }
    throw err;
  }

  // The auto-candidate and the log line need the role; the stored session knows it.
  if (!args.role) args.role = state.role;

  console.log(`\nResuming assessment ${sessionId}`);
  const spec = state.specialization ? ` (${state.specialization})` : "";
  console.log(`Role: ${state.role}${spec}`);
  if (state.candidateName) console.log(`Candidate: ${state.candidateName}`);
  console.log(`Progress: ${state.answeredCount} of ${state.totalQuestions} questions answered`);

  if (state.done) {
    if (state.report) printReport(state.report);
    else console.log("\nThis session is finished, but no report was stored.");
    return null;
  }
  if (!state.question) {
    console.log(
      "\nNo open question to resume: the last answer was saved but not fully graded. Try again in a moment.",
    );
    process.exitCode = 1;
    return null;
  }
  return state.question;
}

async function main(): Promise<void> {
  resetCostUsd();
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  let sessionId: string;
  let current: QuestionPayload;

  if (args.resume) {
    const resumed = await loadResume(args.resume, args);
    if (!resumed) {
      await shutdown();
      return;
    }
    sessionId = args.resume;
    current = resumed;
  } else {
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
    sessionId = start.sessionId;
    current = start.question;
  }

  // Build the real topics + MCQ bank in the background (a no-op for pre-seeded
  // roles). The CLI process stays alive through the answer loop, so it finishes
  // without blocking the first question, mirroring the web app's after() scheduling.
  // submitAnswer also awaits ensureBlueprint as a safety net on the first submit.
  // Idempotent, so a resumed session only pays this if its blueprint or bank was
  // still pending when the previous run stopped.
  void materializeSession(sessionId);

  const rl =
    args.auto === undefined
      ? createInterface({ input: process.stdin, output: process.stdout })
      : null;

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
          sessionId,
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
        `\nCould not get past Q${current.order} after a retry. Progress is saved under session ${sessionId}; resume with --resume ${sessionId}.`,
      );
      bailed = true;
      break;
    }

    const g = result.grade;
    const bandPart =
      g.band !== undefined ? ` · band ${g.band} ${bandName(g.band)}` : "";
    console.log(
      `  grade: ${g.score}/100 coverage${bandPart} · level ${g.demonstratedLevel.toFixed(1)}`,
    );

    if (result.done) {
      printReport(result.report);
      break;
    }

    current = result.question;
    printQuestion(current);
  }

  rl?.close();
  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  printSpend();
  console.log(`\nSession id: ${sessionId}`);
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
