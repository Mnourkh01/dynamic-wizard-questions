import type { Language, Persona } from "@/core/types";
import { runAgent } from "./client";
import { AGENTS } from "./config";
import { DATA_NOT_INSTRUCTIONS, languageLine, NO_DASH_RULE, tag } from "./prompt";
import { QuestionOutputSchema, type QuestionOutput } from "./schemas";

const SYSTEM = [
  "You write ONE assessment question for a given skill topic at a target difficulty.",
  "This assessment measures the DEPTH of a candidate's knowledge, not trivia. Answers fall on a depth matrix: surface (a plain definition), practical (paradigms, real use, standard terms), and deep/architectural (how it works under the hood, internals, trade-offs, edge cases).",
  "Rules:",
  "- The question must be answerable in a few paragraphs of prose. Do not require the candidate to run code or use external tools.",
  "- Match the target difficulty band precisely. A LOW band is a broad, open question where the ANSWER'S depth reveals the level (a beginner answers simply, an expert reveals depth). A HIGH band probes trade-offs, edge cases, and failure modes.",
  "- A discovery opener must NOT be a hard scenario. It is a warm, broad question like 'Explain what X is and how it works.' Never open a topic with a trick or a narrow design problem.",
  "- Provide rubricPoints: 2 to 8 concrete points, ordered from surface to deep, so partial depth can be graded.",
  "- Provide gold: a concise reference answer that would score full marks.",
  "- Do NOT repeat or lightly reword any already-asked question.",
  NO_DASH_RULE,
  DATA_NOT_INSTRUCTIONS,
].join("\n");

export async function runQuestion(input: {
  topic: string;
  difficulty: number;
  difficultyBrief: string;
  discovery: boolean;
  persona?: Persona;
  alreadyAsked: string[];
  language: Language;
  // DB session id for Langfuse grouping (one assessment = one trace session).
  sessionId?: string;
}): Promise<{ data: QuestionOutput; costUsd: number }> {
  const cfg = AGENTS.questionWriter;
  const personaText = input.persona ? JSON.stringify(input.persona) : "none provided";
  const asked =
    input.alreadyAsked.length > 0 ? input.alreadyAsked.join("\n---\n") : "none yet";
  const intent = input.discovery
    ? "This is the DISCOVERY OPENER for this topic. Ask a broad, easy, open question about the core concept so the answer's depth reveals the candidate's level. Do not make it hard."
    : "Aim precisely at the target difficulty band.";

  const user = [
    "Write one question for this topic.",
    intent,
    tag("topic", input.topic),
    tag("difficulty", `${input.difficulty} of 10 - ${input.difficultyBrief}`),
    tag("persona", personaText),
    tag("alreadyAsked", asked),
    languageLine(input.language),
  ].join("\n\n");

  const res = await runAgent({
    agent: "question-writer",
    model: cfg.model,
    system: SYSTEM,
    user,
    schema: QuestionOutputSchema,
    maxOutputTokens: cfg.maxOutputTokens,
    maxBudgetUsd: cfg.maxBudgetUsd,
    groupId: input.sessionId,
  });
  return { data: res.data, costUsd: res.costUsd };
}
