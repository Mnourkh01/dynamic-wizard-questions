import type { Language, Persona } from "@/core/types";
import { runAgent } from "./client";
import { AGENTS } from "./config";
import { DATA_NOT_INSTRUCTIONS, languageLine, NO_DASH_RULE, tag } from "./prompt";
import { BlueprintOutputSchema, type BlueprintOutput } from "./schemas";

const SYSTEM = [
  "You are an expert technical assessor who designs skill assessments.",
  "Given a target role, break it into the distinct skill areas an assessment should measure.",
  "Rules:",
  "- Return 3 to 8 topics, each a specific, non-overlapping skill area for THIS role.",
  "- If a specialization (a stack or focus) is given, SCOPE the topics to it. 'Backend Engineer' with focus 'Python, GCP, LLM agents (Keras, Gemini, ADK)' must yield topics about that exact stack (for example the agent SDK, model serving, cloud services it names), NOT generic backend topics like 'REST APIs' or 'SQL' unless they are truly central to that focus.",
  "- importance is how much each topic counts toward the score, a positive integer on any scale; it is normalized in code, so do not try to make them sum to anything.",
  "- startLevel is the level (1-10) a person matching the persona would typically start at. It only aims the first question. With no persona, use 4.",
  "- Set assessable=false ONLY if the role is genuine nonsense or cannot be assessed as a skill, and then return an empty topics list.",
  NO_DASH_RULE,
  DATA_NOT_INSTRUCTIONS,
].join("\n");

export async function runBlueprint(input: {
  role: string;
  specialization?: string;
  persona?: Persona;
  language: Language;
}): Promise<{ data: BlueprintOutput; costUsd: number }> {
  const cfg = AGENTS.topicPlanner;
  const personaText = input.persona ? JSON.stringify(input.persona) : "none provided";
  const focusText = input.specialization?.trim() || "none provided";
  const user = [
    "Design an assessment blueprint for the following role.",
    tag("role", input.role),
    tag("specialization", focusText),
    tag("persona", personaText),
    languageLine(input.language),
  ].join("\n\n");

  const res = await runAgent({
    agent: "topic-planner",
    model: cfg.model,
    system: SYSTEM,
    user,
    schema: BlueprintOutputSchema,
    maxOutputTokens: cfg.maxOutputTokens,
    maxBudgetUsd: cfg.maxBudgetUsd,
  });
  return { data: res.data, costUsd: res.costUsd };
}
