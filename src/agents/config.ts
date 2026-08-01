// Per-agent model + output-token budget + call deadline, all in one place so
// they can be tuned without touching agent code. The token cap is enforced
// through CLAUDE_CODE_MAX_OUTPUT_TOKENS on the spawned child (the SDK has no
// per-call maxOutputTokens option); maxBudgetUsd is a first-class runaway-cost
// guard; timeoutMs is the hard deadline per CLI spawn (a hung `claude` child
// must never hang a submit forever).

// Config keys are the plain, self-documenting agent names; the same names are
// used as the Langfuse trace label for each agent so a trace reads at a glance.
export type AgentName =
  | "topicPlanner"
  | "questionWriter"
  | "answerGrader"
  | "answerScanner"
  | "reportWriter"
  | "mcqWriter";

export interface AgentConfig {
  model: string; // CLI alias: "opus" | "sonnet" | "haiku"
  maxOutputTokens: number;
  maxBudgetUsd: number;
  timeoutMs: number; // hard per-call deadline; abort + one transient retry past this
}

// Baseline deadline for any agent call. Generous next to a normal haiku round
// trip (5-15s) because subscription spawns can stall for tens of seconds; the
// point is to bound a HUNG child, not to race a slow-but-alive one.
export const DEFAULT_AGENT_TIMEOUT_MS = 120_000;

export const AGENTS: Record<AgentName, AgentConfig> = {
  // Structure a role (plus its specialization) into weighted topics. A well-scoped,
  // schema-constrained task, so Haiku is fast and enough. This is the "reading the
  // role" step the user waits on at Begin, so speed matters most here.
  // timeoutMs: one small JSON blob, the default deadline has ample headroom.
  topicPlanner: {
    model: "haiku",
    maxOutputTokens: 4000,
    maxBudgetUsd: 0.5,
    timeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
  },
  // Fast single-question generation, schema-constrained. Haiku for low latency:
  // this runs on the hot path between every question.
  // timeoutMs: hot path; anything past the default is a wedged child, cut it.
  questionWriter: {
    model: "haiku",
    maxOutputTokens: 2000,
    maxBudgetUsd: 0.3,
    timeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
  },
  // The critical path: strict judgment of a free-text answer, and the number the
  // whole product is trusted on. Sonnet (down from Opus) roughly halves submit
  // latency; kept honest by the validity gate (npm run validity). Revert to "opus"
  // if that gate ever regresses on ranking or variance.
  // timeoutMs: sonnet is slower than haiku but one grade is one bounded JSON blob.
  answerGrader: {
    model: "sonnet",
    maxOutputTokens: 6000,
    maxBudgetUsd: 1.0,
    timeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
  },
  // Text mode's critical path: three parallel reads of one written answer, each
  // reporting quote-backed observations and no numbers. Sonnet is the starting
  // point because it already passes the validity gate as the grader; the gate
  // decides whether that holds, and the escalation if it does not is Opus here,
  // not a longer prompt.
  // timeoutMs: three concurrent CLI children make each one slower than a lone
  // call, so the deadline is roomier than the default.
  // 8000 because a staff-level answer legitimately trips many signals at once and
  // the judgment scan overflowed 4000 on exactly that case in the golden set.
  answerScanner: {
    model: "sonnet",
    maxOutputTokens: 8000,
    maxBudgetUsd: 0.5,
    timeoutMs: 180_000,
  },
  // Synthesize the transcript into a report. Runs once at the end, off the
  // interactive hot path, so Sonnet stays for prose quality.
  // timeoutMs: 240s, the longest prose output in the system on the slower model,
  // and nobody is blocked mid-question while it runs.
  reportWriter: {
    model: "sonnet",
    maxOutputTokens: 6000,
    maxBudgetUsd: 0.7,
    timeoutMs: 240_000,
  },
  // Batch-generate the whole MCQ pool for a session in ONE call at start, so every
  // later MCQ round is pure DB work. Haiku is fast and enough for well-scoped MCQs;
  // a generous token cap because it emits many questions at once.
  // timeoutMs: 240s, the biggest single output (up to 8k tokens of MCQs) and it
  // runs on a background path, so trading latency for fewer truncation retries.
  mcqWriter: {
    model: "haiku",
    maxOutputTokens: 8000,
    maxBudgetUsd: 0.6,
    timeoutMs: 240_000,
  },
};

// The agent modules pass a kebab-case trace label (e.g. "answer-grader") to
// runAgent, not the config key, so the client resolves the deadline here.
// Labels without a config entry (e.g. "smoke", "sim-candidate") get the default.
const TIMEOUT_BY_LABEL: Record<string, AgentName> = {
  "topic-planner": "topicPlanner",
  "question-writer": "questionWriter",
  "answer-grader": "answerGrader",
  "interview-writer": "questionWriter",
  "answer-scanner-build": "answerScanner",
  "answer-scanner-judgment": "answerScanner",
  "answer-scanner-coverage": "answerScanner",
  "report-writer": "reportWriter",
  "mcq-writer": "mcqWriter",
  // The single-MCQ fallback writer shares the questionWriter budget: same shape
  // of work (one question), same hot path.
  "mcq-writer-single": "questionWriter",
};

export function timeoutMsForAgentLabel(label: string): number {
  const name = TIMEOUT_BY_LABEL[label];
  return name ? AGENTS[name].timeoutMs : DEFAULT_AGENT_TIMEOUT_MS;
}
