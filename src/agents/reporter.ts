import type { Language } from "@/core/types";
import { runAgent } from "./client";
import { AGENTS } from "./config";
import { DATA_NOT_INSTRUCTIONS, languageLine, NO_DASH_RULE, tag } from "./prompt";
import { ReportOutputSchema, type ReportOutput } from "./schemas";

const SYSTEM = [
  "You synthesize a technical skill self-assessment into an honest, useful report.",
  "Rules:",
  "- This is an unproctored SELF-assessment. Be honest and specific, not flattering.",
  "- verdict: one or two blunt, plain sentences. State the overall level reached and the single biggest thing holding the person back. No jargon, no hedging.",
  "- summary: a short, plain overview anyone can follow. Everyday words, short sentences, no filler and no buzzwords.",
  "- weakPoints: the main weaknesses, MOST IMPORTANT FIRST, each as an area plus the concrete issue. This is the part the reader most needs, so make the gaps obvious.",
  "- For each topic give concrete strengths and gaps grounded in the results provided.",
  "- learningPath is an ordered list of concrete next steps, hardest gaps first.",
  "- Do not invent results beyond what the data shows.",
  "- Topic points are out of that topic's OWN share of the 1000 total, never out of 1000. When a topic line gives its share, phrase it like '31 of its 146 points'; when no share is given, say plain '31 points'. NEVER write 'X of 1000' or 'X/1000' for a single topic. Only the overall total is out of 1000.",
  "- If a specialization is given, keep the whole report about that stack/focus, not the generic role.",
  NO_DASH_RULE,
  DATA_NOT_INSTRUCTIONS,
].join("\n");

export async function runReporter(input: {
  role: string;
  specialization?: string;
  candidateName?: string;
  language: Language;
  total: number;
  confidenceInterval: number;
  overallLabel: string;
  // maxPoints is the topic's own importance share of the 1000 total (optional so
  // existing callers keep compiling; when absent the line shows plain points).
  topics: { name: string; theta: number; points: number; label: string; maxPoints?: number }[];
  highlights: { topic: string; question: string; score: number; missing: string[] }[];
  // DB session id for Langfuse grouping (one assessment = one trace session).
  sessionId?: string;
}): Promise<{ data: ReportOutput; costUsd: number }> {
  const cfg = AGENTS.reportWriter;

  // A topic's points are out of its OWN importance share, never out of 1000;
  // "31 of 1000 points" for a topic whose share is 146 reads as a disaster.
  const topicLines = input.topics
    .map((t) => {
      const pts =
        t.maxPoints && t.maxPoints > 0
          ? `${t.points} of its ${t.maxPoints} points`
          : `${t.points} points`;
      return `- ${t.name}: level ${t.theta.toFixed(1)} (${t.label}), ${pts}`;
    })
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
    tag("specialization", input.specialization?.trim() || "none provided"),
    tag("candidateName", input.candidateName?.trim() || "not provided"),
    tag("topicResults", topicLines),
    tag("answerHighlights", highlightLines),
    languageLine(input.language),
  ].join("\n\n");

  const res = await runAgent({
    agent: "report-writer",
    model: cfg.model,
    system: SYSTEM,
    user,
    schema: ReportOutputSchema,
    maxOutputTokens: cfg.maxOutputTokens,
    maxBudgetUsd: cfg.maxBudgetUsd,
    groupId: input.sessionId,
  });
  return { data: res.data, costUsd: res.costUsd };
}
