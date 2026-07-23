// Per-agent model + output-token budget, all in one place so they can be tuned
// without touching agent code. The token cap is enforced through
// CLAUDE_CODE_MAX_OUTPUT_TOKENS on the spawned child (the SDK has no per-call
// maxOutputTokens option); maxBudgetUsd is a first-class runaway-cost guard.

export type AgentName = "blueprint" | "question" | "grader" | "reporter";

export interface AgentConfig {
  model: string; // CLI alias: "opus" | "sonnet" | "haiku"
  maxOutputTokens: number;
  maxBudgetUsd: number;
}

export const AGENTS: Record<AgentName, AgentConfig> = {
  // Structure a role into weighted topics. Sonnet is enough; save Opus for grading.
  blueprint: { model: "sonnet", maxOutputTokens: 4000, maxBudgetUsd: 0.5 },
  // Fast single-question generation. Cheap, tight cap.
  question: { model: "sonnet", maxOutputTokens: 2000, maxBudgetUsd: 0.3 },
  // The critical path: strict judgment of a free-text answer. The only Opus call.
  grader: { model: "opus", maxOutputTokens: 6000, maxBudgetUsd: 1.0 },
  // Synthesize the transcript into a report. Sonnet is enough.
  reporter: { model: "sonnet", maxOutputTokens: 6000, maxBudgetUsd: 0.7 },
};
