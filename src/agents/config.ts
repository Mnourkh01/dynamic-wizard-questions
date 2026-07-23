// Per-agent model + output-token budget, all in one place so they can be tuned
// without touching agent code. The token cap is enforced through
// CLAUDE_CODE_MAX_OUTPUT_TOKENS on the spawned child (the SDK has no per-call
// maxOutputTokens option); maxBudgetUsd is a first-class runaway-cost guard.

export type AgentName = "blueprint" | "question" | "grader" | "reporter" | "bankBuilder";

export interface AgentConfig {
  model: string; // CLI alias: "opus" | "sonnet" | "haiku"
  maxOutputTokens: number;
  maxBudgetUsd: number;
}

export const AGENTS: Record<AgentName, AgentConfig> = {
  // Structure a role into weighted topics. A well-scoped, schema-constrained task,
  // so Haiku is fast and enough. This is the "reading the role" step the user waits
  // on at Begin, so speed matters most here.
  blueprint: { model: "haiku", maxOutputTokens: 4000, maxBudgetUsd: 0.5 },
  // Fast single-question generation, schema-constrained. Haiku for low latency:
  // this runs on the hot path between every question.
  question: { model: "haiku", maxOutputTokens: 2000, maxBudgetUsd: 0.3 },
  // The critical path: strict judgment of a free-text answer, and the number the
  // whole product is trusted on. Sonnet (down from Opus) roughly halves submit
  // latency; kept honest by the validity gate (npm run validity). Revert to "opus"
  // if that gate ever regresses on ranking or variance.
  grader: { model: "sonnet", maxOutputTokens: 6000, maxBudgetUsd: 1.0 },
  // Synthesize the transcript into a report. Runs once at the end, off the
  // interactive hot path, so Sonnet stays for prose quality.
  reporter: { model: "sonnet", maxOutputTokens: 6000, maxBudgetUsd: 0.7 },
  // Batch-generate the whole MCQ pool for a session in ONE call at start, so every
  // later MCQ round is pure DB work. Haiku is fast and enough for well-scoped MCQs;
  // a generous token cap because it emits many questions at once.
  bankBuilder: { model: "haiku", maxOutputTokens: 8000, maxBudgetUsd: 0.6 },
};
