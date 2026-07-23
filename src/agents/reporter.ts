import type { Language } from "@/core/types";
import { runAgent } from "./client";
import { AGENTS } from "./config";
import { DATA_NOT_INSTRUCTIONS, languageLine, NO_DASH_RULE, tag } from "./prompt";
import { ReportOutputSchema, type ReportOutput } from "./schemas";

const SYSTEM = [
  "You synthesize a technical skill self-assessment into an honest, useful report.",
  "Rules:",
  "- This is an unproctored SELF-assessment. Be honest and specific, not flattering.",
  "- For each topic give concrete strengths and gaps grounded in the results provided.",
  "- learningPath is an ordered list of concrete next steps, hardest gaps first.",
  "- Do not invent results beyond what the data shows.",
  NO_DASH_RULE,
  DATA_NOT_INSTRUCTIONS,
].join("\n");

export async function runReporter(input: {
  role: string;
  language: Language;
  total: number;
  confidenceInterval: number;
  overallLabel: string;
  topics: { name: string; theta: number; points: number; label: string }[];
  highlights: { topic: string; question: string; score: number; missing: string[] }[];
}): Promise<{ data: ReportOutput; costUsd: number }> {
  const cfg = AGENTS.reporter;

  const topicLines = input.topics
    .map((t) => `- ${t.name}: level ${t.theta.toFixed(1)} (${t.label}), ${t.points} of 1000 points`)
    .join("\n");

  const highlightLines = input.highlights
    .map(
      (h) =>
        `- [${h.topic}] scored ${h.score}/100. Missed: ${h.missing.length ? h.missing.join("; ") : "nothing notable"}`,
    )
    .join("\n");

  const user = [
    `Write the assessment report. Overall: ${input.total} of 1000 (plus or minus ${input.confidenceInterval}), level ${input.overallLabel}.`,
    tag("role", input.role),
    tag("topicResults", topicLines),
    tag("answerHighlights", highlightLines),
    languageLine(input.language),
  ].join("\n\n");

  const res = await runAgent({
    agent: "reporter",
    model: cfg.model,
    system: SYSTEM,
    user,
    schema: ReportOutputSchema,
    maxOutputTokens: cfg.maxOutputTokens,
    maxBudgetUsd: cfg.maxBudgetUsd,
  });
  return { data: res.data, costUsd: res.costUsd };
}
