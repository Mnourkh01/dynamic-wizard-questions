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
  });
  return { data: res.data, costUsd: res.costUsd };
}
