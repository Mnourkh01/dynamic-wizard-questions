// Pure domain types shared across core, agents, and the orchestrator. No I/O,
// no framework, no SDK types leak in here.

export type Language = "en" | "ar";

// How a session asks its questions. Stamped on the session at start and fixed for
// its lifetime: "mcq" is the v1 pre-generated bank, "text" is the adaptive written
// interview. A session never changes mode mid-run.
export type AssessmentMode = "mcq" | "text";

export interface Persona {
  background?: string;
  years?: number;
}

// A topic as proposed by the Blueprint agent. `importance` is normalized in code
// to sum to exactly 1000 across the session (never trust the LLM to do the math).
export interface TopicBlueprint {
  name: string;
  importance: number; // this topic's share of the 1000-point total
  startLevel: number; // starting level guess 1..10, persona-informed, used ONLY to pick the first question
}

export interface Blueprint {
  role: string;
  topics: TopicBlueprint[];
}

// The deterministic ability state the engine carries per topic.
export interface TopicState {
  name: string;
  importance: number; // this topic's share of the 1000-point total
  theta: number; // live ability estimate, 1..10 (starts neutral, NOT at startLevel)
  sigma: number; // uncertainty (std dev)
  startLevel: number; // persona-informed 1..10, aims ONLY the first question
  questionsAsked: number;
  answeredCount: number; // graded observations
  consecutiveStrong: number; // streak feeding the ceiling probe
  converged: boolean;
  points: number; // importance * theta/10, filled at scoring time
}

// The normalized grade the engine consumes. Produced from the Grader agent's
// raw output PLUS code-side degeneracy detection. deterministicConfidence is
// computed by core, never taken from the model.
export interface Grade {
  score: number; // 0..100
  demonstratedLevel: number; // 1..10
  matchedCount: number;
  missingCount: number;
  degenerate: boolean; // empty / gibberish / too-short answer flagged by code
  // True when demonstratedLevel is a real reading of how deep the answer went.
  // False (the default) when it is a bracket inferred from a right or wrong
  // pick, which is one-sided evidence: a correct pick proves ability at least at
  // the item's level and says nothing about the ceiling. Only bracket evidence
  // gets the one-sided gate in applyGrade; a depth reading may move the estimate
  // in either direction because it is an actual measurement.
  measuresDepth?: boolean;
}

// What the engine decides to do next. `discovery` marks the single warm-up (the
// first written question of the whole session); `ceilingProbe` marks a deliberate
// probe one level above the estimate.
export type EngineDecision =
  | {
      kind: "ask";
      topicIndex: number;
      difficulty: number;
      ceilingProbe: boolean;
      discovery: boolean;
      // How to ask it. "mcq" is served instantly from the pre-generated bank (no
      // AI); "text" is a free-text depth probe graded by the AI. Deterministic:
      // the engine, not a model, decides the format.
      format: "mcq" | "text";
      // When opening a FRESH topic mid-session, carry the candidate's running
      // ability into it so it continues at their level instead of resetting to a
      // level-2 warm-up. The orchestrator seeds the new topic's theta with this.
      seedTheta?: number;
    }
  | { kind: "done" };

// The scored result at the end of a session.
export interface TopicScore {
  name: string;
  importance: number;
  theta: number;
  sigma: number;
  points: number; // contribution to the 1000, = round(importance * theta/10)
  label: string;
}

export interface FinalScore {
  total: number; // 0..1000 headline (sum of per-topic points)
  confidenceInterval: number; // +/- band on the headline
  topics: TopicScore[];
  overallLabel: string;
}
