// Pure domain types shared across core, agents, and the orchestrator. No I/O,
// no framework, no SDK types leak in here.

export type Language = "en" | "ar";

export interface Persona {
  background?: string;
  years?: number;
}

// A topic as proposed by the Blueprint agent, after code has normalized weights
// to sum to exactly 1000 (never trust the LLM to do the arithmetic).
export interface TopicBlueprint {
  name: string;
  weight: number; // integer; all weights in a session sum to 1000
  prior: number; // starting ability 1..10, persona-informed, used ONLY for the first question pick
}

export interface Blueprint {
  role: string;
  topics: TopicBlueprint[];
}

// The deterministic ability state the engine carries per topic.
export interface TopicState {
  name: string;
  weight: number;
  theta: number; // ability estimate, 1..10 (starts neutral, NOT at the prior)
  sigma: number; // uncertainty (std dev)
  firstPickPrior: number; // persona-informed 1..10, aims ONLY the first question
  questionsAsked: number;
  answeredCount: number; // graded observations
  consecutiveStrong: number; // streak feeding the ceiling probe
  converged: boolean;
  points: number; // weight * theta/10, filled at scoring time
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
}

// What the engine decides to do next. `discovery` marks a broad calibration
// opener; `ceilingProbe` marks a deliberate probe one level above the estimate.
export type EngineDecision =
  | {
      kind: "ask";
      topicIndex: number;
      difficulty: number;
      ceilingProbe: boolean;
      discovery: boolean;
    }
  | { kind: "done" };

// The scored result at the end of a session.
export interface TopicScore {
  name: string;
  weight: number;
  theta: number;
  sigma: number;
  points: number; // contribution to the 1000, = round(weight * theta/10)
  label: string;
}

export interface FinalScore {
  total: number; // 0..1000 headline (sum of per-topic points)
  confidenceInterval: number; // +/- band on the headline
  topics: TopicScore[];
  overallLabel: string;
}
