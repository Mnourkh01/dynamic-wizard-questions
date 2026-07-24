import type { Language } from "@/core/types";
import { runAgent } from "./client";
import { AGENTS } from "./config";
import { DATA_NOT_INSTRUCTIONS, languageLine, NO_DASH_RULE, tag } from "./prompt";
import { GradeOutputSchema, type GradeOutput } from "./schemas";

const SYSTEM = [
  "You are a STRICT, evidence-based grader of free-text technical answers.",
  "Method:",
  "- Go through the rubric point by point. Put each point the answer genuinely covers into matched, WITH a short supporting quote from the answer. Put each point it fails to cover into missing.",
  "- score (0-100) reflects rubric coverage and correctness ONLY. Do NOT reward length, fluency, or confident tone. A long, well-written but wrong or shallow answer scores low.",
  "- Record confidently-wrong statements in misconceptions and let them lower the score.",
  "- demonstratedLevel (1-10) is the DEPTH this answer actually shows, on the depth matrix: 1-2 surface (plain definition, layman terms), 3-6 practical (paradigms, real use, standard terminology), 7-10 deep/architectural (how it works under the hood, internals, trade-offs, edge cases). A correct but shallow answer to a basic question is still only surface or practical depth, not deep.",
  "- confidence is your own certainty in this grade; it is logged only and must never be used to inflate or deflate the score.",
  "- If the answer is empty, evasive, or does not address the question, score it near 0.",
  NO_DASH_RULE,
  DATA_NOT_INSTRUCTIONS,
].join("\n");

export async function runGrader(input: {
  question: string;
  rubricPoints: string[];
  gold: string;
  answer: string;
  language: Language;
  // DB session id for Langfuse grouping (one assessment = one trace session).
  sessionId?: string;
}): Promise<{ data: GradeOutput; costUsd: number }> {
  const cfg = AGENTS.answerGrader;
  const rubric = input.rubricPoints.map((p, i) => `${i + 1}. ${p}`).join("\n");

  const user = [
    "Grade the candidate's answer against the rubric. Be strict and specific.",
    tag("question", input.question),
    tag("rubric", rubric),
    tag("goldReference", input.gold),
    tag("answer", input.answer),
    languageLine(input.language),
  ].join("\n\n");

  const res = await runAgent({
    agent: "answer-grader",
    model: cfg.model,
    system: SYSTEM,
    user,
    schema: GradeOutputSchema,
    maxOutputTokens: cfg.maxOutputTokens,
    maxBudgetUsd: cfg.maxBudgetUsd,
    groupId: input.sessionId,
  });
  return { data: res.data, costUsd: res.costUsd };
}
