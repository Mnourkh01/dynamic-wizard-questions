// Named engine constants. Every number the adaptive loop depends on lives here,
// so behavior is tuned in one place and tests can reference the same values.
// Ability is on a 1..10 scale (see ladder.ts).

export const THETA_MIN = 1;
export const THETA_MAX = 10;

// Every topic's running estimate starts neutral (mid). The persona/experience
// prior is deliberately NOT seeded here: it only aims the first question's
// difficulty, so an over-claimed persona cannot inflate the final estimate.
export const NEUTRAL_START_THETA = 5;

// Uncertainty (sigma) is the standard deviation of a topic's ability estimate.
export const INITIAL_SIGMA = 2.0; // wide: we know little at the start
export const SIGMA_FLOOR = 0.35; // never collapse to zero certainty
export const SIGMA_THRESHOLD = 0.6; // a topic converges when sigma drops below this

// Kalman-style measurement noise. Larger noise => each answer moves the estimate
// less, so a single grade cannot swing theta hard.
export const NOISE = 1.0;

// Deterministic confidence bounds (from matched/missing rubric points, never the
// LLM's self-reported confidence).
export const CONFIDENCE_MIN = 0.3;
export const CONFIDENCE_MAX = 0.8;

// A topic must have at least this many graded answers before any sigma-based
// stop is allowed, so one lucky/unlucky answer can never converge a topic.
export const MIN_QUESTIONS_PER_TOPIC = 2;
// Hard ceiling per topic regardless of convergence (humane + cost guard).
export const MAX_QUESTIONS_PER_TOPIC = 5;
// Humane whole-session cap. A session is meant to be ~15-25 questions.
// Overridable via env for cheap end-to-end test runs (defaults to 24).
export const GLOBAL_MAX_QUESTIONS = Number(process.env.MAX_QUESTIONS ?? 24);

// The opening ("discovery") difficulty for a topic. Every topic starts with a
// broad, easy calibration question so answer DEPTH reveals the level, then the
// estimate fast-forwards up or steps down. The persona prior does NOT raise the
// opener: a strong candidate is found by acing the broad opener, not by being
// handed a hard question cold.
export const DISCOVERY_LEVEL = 2;

// After this many consecutive strong answers, probe one level up to find a user
// whose true ability is above the current estimate.
export const CEILING_PROBE_AFTER = 2;
// A grade at or above this (out of 100) counts as a "strong" answer.
export const STRONG_SCORE = 75;

// Below this raw score the answer is treated as failing the question (used only
// to reset the consecutive-strong streak, not in the theta math).
export const WEAK_SCORE = 40;

// Hybrid mode: at most this many free-text, AI-graded depth probes per whole
// session (the slow questions). Ceiling probes beyond this are served as harder
// MCQ, so a strong candidate stays fast while depth is still confirmed a couple
// of times where it matters most.
export const MAX_TEXT_PROBES = 2;
