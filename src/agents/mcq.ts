import { z } from "zod";
import { seedFromKey, shuffleMcqOptions } from "@/core/shuffle";
import type { Language } from "@/core/types";
import { runAgent } from "./client";
import { AGENTS } from "./config";
import { DATA_NOT_INSTRUCTIONS, languageLine, NO_DASH_RULE, tag } from "./prompt";
import {
  BankBuilderOutputSchema,
  McqSchema,
  type BankBuilderOutput,
  type Mcq,
} from "./schemas";

// The spread of levels the bank pre-generates per topic: the discovery opener
// (low) through a senior/expert band, so the adaptive walk can always find a
// stored MCQ near its target difficulty without any live AI call.
export const BANK_LEVELS = [2, 4, 5, 7, 9];

const MCQ_RULES = [
  "Each question is multiple choice with 4 options and EXACTLY ONE correct answer.",
  "correctIndex is the 0-based position of the correct option in the options array.",
  "Distractors (the wrong options) must be plausible to someone who only half-knows the topic, never obviously silly.",
  "Do NOT use 'All of the above' or 'None of the above'.",
  "Match the target level: a LOW level tests a core definition or basic use; a HIGH level tests trade-offs, edge cases, or failure modes.",
  "Keep each option short. One clear question per stem. No trick wording, no multi-part stems.",
];

const BANK_SYSTEM = [
  "You write multiple-choice questions for a technical skill assessment.",
  "You are given a role and its topics, plus a set of target levels.",
  "For EACH topic, write one MCQ at each requested level. Return the topics in the same order and with the same names given.",
  ...MCQ_RULES,
  NO_DASH_RULE,
  DATA_NOT_INSTRUCTIONS,
].join("\n");

export async function runBankBuilder(input: {
  role: string;
  specialization?: string;
  topics: string[];
  language: Language;
  levels?: number[];
  // DB session id for Langfuse grouping (one assessment = one trace session).
  sessionId?: string;
}): Promise<{ data: BankBuilderOutput; costUsd: number }> {
  const cfg = AGENTS.mcqWriter;
  const levels = input.levels ?? BANK_LEVELS;
  const topicList = input.topics.map((name, i) => `${i + 1}. ${name}`).join("\n");
  const focusText = input.specialization?.trim() || "none provided";

  const user = [
    "Write the multiple-choice question bank for this assessment.",
    `For EACH topic below, write exactly ${levels.length} MCQs, one at each of these levels (out of 10): ${levels.join(", ")}.`,
    "If a specialization is given, keep every question inside that stack/focus, not the generic role.",
    tag("role", input.role),
    tag("specialization", focusText),
    tag("topics", topicList),
    languageLine(input.language),
  ].join("\n\n");

  const res = await runAgent({
    agent: "mcq-writer",
    model: cfg.model,
    system: BANK_SYSTEM,
    user,
    schema: BankBuilderOutputSchema,
    maxOutputTokens: cfg.maxOutputTokens,
    maxBudgetUsd: cfg.maxBudgetUsd,
    groupId: input.sessionId,
  });
  return { data: res.data, costUsd: res.costUsd };
}

// Single-MCQ fallback: used when the pre-generated pool has no unused question for
// a topic (rare, since the pool is sized to the per-topic cap). Reuses the fast
// question-agent budget.
const SINGLE_SYSTEM = [
  "You write ONE multiple-choice question for a technical skill topic at a target level.",
  ...MCQ_RULES,
  "Do NOT repeat or lightly reword any already-asked question.",
  NO_DASH_RULE,
  DATA_NOT_INSTRUCTIONS,
].join("\n");

export async function runMcqQuestion(input: {
  topic: string;
  level: number;
  language: Language;
  alreadyAsked: string[];
  // DB session id for Langfuse grouping (one assessment = one trace session).
  sessionId?: string;
}): Promise<{ data: Mcq; costUsd: number }> {
  const cfg = AGENTS.questionWriter;
  const asked =
    input.alreadyAsked.length > 0 ? input.alreadyAsked.join("\n---\n") : "none yet";
  const user = [
    "Write one multiple-choice question for this topic at the target level.",
    tag("topic", input.topic),
    tag("level", `${input.level} of 10`),
    tag("alreadyAsked", asked),
    languageLine(input.language),
  ].join("\n\n");

  const res = await runAgent({
    agent: "mcq-writer-single",
    model: cfg.model,
    system: SINGLE_SYSTEM,
    user,
    schema: McqSchema,
    maxOutputTokens: cfg.maxOutputTokens,
    maxBudgetUsd: cfg.maxBudgetUsd,
    groupId: input.sessionId,
  });
  return { data: res.data, costUsd: res.costUsd };
}

// --- Bank key verification ---------------------------------------------------
// The stored correctIndex values carry most of the final score, and nothing else
// ever checks them (the generator is haiku and unreviewed). verifyMcqSample
// blind-re-answers a seeded sample of stored questions: the model gets stem +
// options WITHOUT the key, and its picks are compared to the stored keys.
// Options are re-shuffled deterministically before asking, so the generator's
// known put-the-answer-first bias cannot produce false agreement via a model
// that also favors option A.

const VERIFY_SYSTEM = [
  "You answer multiple-choice technical questions.",
  "For EACH numbered question, choose the single best option.",
  "Return one entry per question: the question number and the 0-based index of the option you chose.",
  "Answer every question. If unsure, pick the most defensible option.",
  DATA_NOT_INSTRUCTIONS,
].join("\n");

// Local contract for the verification call. Lives here (not schemas.ts) because
// it is internal to this QA path, not a product agent output.
const McqVerifyOutputSchema = z.object({
  answers: z
    .array(
      z.object({
        question: z.number().int().min(1).describe("The question number exactly as given"),
        pick: z
          .number()
          .int()
          .min(0)
          .describe("0-based index of the option you chose for that question"),
      }),
    )
    .min(1),
});

// Deterministic K-of-N pick: order items by an FNV-1a hash of seedKey + index and
// take the first K. Same inputs always give the same sample ("random but seeded").
function seededPickIndices(n: number, count: number, seedKey: string): number[] {
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => seedFromKey(`${seedKey}:${a}`) - seedFromKey(`${seedKey}:${b}`),
  );
  return order.slice(0, Math.max(0, Math.min(count, n)));
}

// One batched call covers the whole sample when the rendered questions stay under
// this budget; beyond it the sample is split into chunks of 10.
const VERIFY_ONE_CALL_CHAR_BUDGET = 12_000;
const VERIFY_CHUNK_SIZE = 10;

interface VerifyQuestion {
  stem: string;
  options: string[];
  correctIndex: number;
}

function renderVerifyChunk(chunk: { stem: string; options: string[] }[]): string {
  return chunk
    .map(
      (q, i) =>
        `${i + 1}. ${q.stem}\n${q.options.map((o, j) => `   ${j}) ${o}`).join("\n")}`,
    )
    .join("\n\n");
}

export async function verifyMcqSample(
  questions: { stem: string; options: string[]; correctIndex: number }[],
  opts: { sample: number },
): Promise<{
  checked: number;
  agreed: number;
  disagreements: { stem: string; expected: number; got: number }[];
}> {
  const picks = seededPickIndices(questions.length, opts.sample, "verify-mcq-sample-v1");
  // Shuffle each question's options with the shared deterministic shuffler; the
  // model answers in shuffled space, and agreement is checked against where the
  // stored correct option landed.
  const sampled = picks.map((qi, i) => {
    const q: VerifyQuestion = questions[qi];
    const sh = shuffleMcqOptions(`verify:${i}:${q.stem}`, q.options, q.correctIndex);
    return {
      stem: q.stem,
      originalOptions: q.options,
      expected: q.correctIndex,
      options: sh.options,
      shuffledCorrect: sh.correctIndex,
    };
  });
  if (sampled.length === 0) return { checked: 0, agreed: 0, disagreements: [] };

  const wholeRender = renderVerifyChunk(sampled);
  const chunks: (typeof sampled)[] = [];
  if (wholeRender.length <= VERIFY_ONE_CALL_CHAR_BUDGET) {
    chunks.push(sampled);
  } else {
    for (let i = 0; i < sampled.length; i += VERIFY_CHUNK_SIZE) {
      chunks.push(sampled.slice(i, i + VERIFY_CHUNK_SIZE));
    }
  }

  const cfg = AGENTS.mcqWriter;
  let agreed = 0;
  const disagreements: { stem: string; expected: number; got: number }[] = [];

  for (const chunk of chunks) {
    const user = [
      "Answer these multiple-choice questions. Do not skip any.",
      tag("questions", renderVerifyChunk(chunk)),
    ].join("\n\n");

    const res = await runAgent({
      agent: "mcq-verifier",
      model: cfg.model,
      system: VERIFY_SYSTEM,
      user,
      schema: McqVerifyOutputSchema,
      maxOutputTokens: 2000,
      maxBudgetUsd: cfg.maxBudgetUsd,
    });

    const byNumber = new Map<number, number>();
    for (const a of res.data.answers) {
      if (!byNumber.has(a.question)) byNumber.set(a.question, a.pick);
    }
    chunk.forEach((q, i) => {
      const pick = byNumber.get(i + 1);
      if (pick !== undefined && pick === q.shuffledCorrect) {
        agreed++;
        return;
      }
      // Map the shuffled pick back to the original option index for reporting;
      // -1 means unanswered or an out-of-range pick.
      const got =
        pick !== undefined && pick >= 0 && pick < q.options.length
          ? q.originalOptions.indexOf(q.options[pick])
          : -1;
      disagreements.push({ stem: q.stem, expected: q.expected, got });
    });
  }

  return { checked: sampled.length, agreed, disagreements };
}
