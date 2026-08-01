// Named engine constants. Every number the adaptive loop depends on lives here,
// so behavior is tuned in one place and tests can reference the same values.
// Ability is on a 1..10 scale (see ladder.ts).

export const THETA_MIN = 1;
export const THETA_MAX = 10;

// A topic's running estimate no longer starts at a neutral mid-point. It starts
// LOW, at the 101 opener level, and climbs only by earning it (see DISCOVERY_LEVEL
// / START_THETA below). This is what makes the assessment an organized ladder: it
// opens simple and moves up 102, 103, 104 based on the answers.

// Uncertainty (sigma) is the standard deviation of a topic's ability estimate.
// Wide at the start so the FIRST answer (the written 101 opener, whose AI-graded
// depth is a strong signal) can move the estimate a lot: an expert opener answer
// jumps the level up several rungs at once, a shallow one barely moves it. It then
// shrinks fast as MCQ rounds confirm.
export const INITIAL_SIGMA = 3.0;
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
// The answer count at which a topic is treated as converged in isTopicConverged
// (a data-sufficiency guard). It is NOT a hard per-question ceiling: the session
// spends its full fixed budget spread across topics, so with very few topics the
// least-covered fallback in selectTopicIndex can revisit a topic beyond this.
export const MAX_QUESTIONS_PER_TOPIC = 5;
// Fixed whole-session length: the assessment always asks exactly this many
// questions, then reports (the session does NOT stop early on convergence, so the
// user always completes a full assessment). Overridable via env for cheap
// end-to-end test runs.
//
// These are DEFAULTS FOR A NEW SESSION ONLY. The length a running session obeys is
// stamped on Session.maxQuestions at start, because this module is evaluated once
// per process: changing the env (or restarting on a new default) would otherwise
// silently change the length of an assessment already in progress.
const MAX_QUESTIONS_OVERRIDE = process.env.MAX_QUESTIONS
  ? Number(process.env.MAX_QUESTIONS)
  : undefined;

export const GLOBAL_MAX_QUESTIONS = MAX_QUESTIONS_OVERRIDE ?? 25;

// Text mode asks fewer questions because each one carries far more information: a
// graded open answer is worth roughly two to four dichotomous items, so 12 written
// answers measure more than 25 multiple-choice picks did. See docs/PLAN-v2.md.
export const TEXT_MAX_QUESTIONS = MAX_QUESTIONS_OVERRIDE ?? 12;

// Which mode a NEW session starts in. Existing sessions keep the mode stamped on
// their row, so flipping this never disturbs a run in progress.
export const DEFAULT_ASSESSMENT_MODE: "mcq" | "text" =
  process.env.ASSESSMENT_MODE === "text" ? "text" : "mcq";

// The "101" level. Every topic OPENS here (a simple intro question) and every
// topic's ability estimate STARTS here, then climbs only on evidence. Like a
// course: 101 first, then 102, 103, 104 based on how the answers go. A strong
// answer jumps the estimate up several levels, so the next question skips ahead
// (102 -> 104); a 101-level answer nudges it one step (101 -> 102). The persona
// does NOT raise the opener: everyone starts at 101 for a fair, organized climb,
// so it can never inflate the score.
export const DISCOVERY_LEVEL = 2;
export const START_THETA = DISCOVERY_LEVEL;

// After this many consecutive strong answers, probe one level up to find a user
// whose true ability is above the current estimate.
export const CEILING_PROBE_AFTER = 2;
// A grade at or above this (out of 100) counts as a "strong" answer.
export const STRONG_SCORE = 75;

// Below this raw score the answer is treated as failing the question (used only
// to reset the consecutive-strong streak, not in the theta math).
export const WEAK_SCORE = 40;

// At or below this band an answer counts as weak for the purpose of choosing the
// next question. Two of these in a row triggers an easier question, to tell "does
// not know this area" apart from "had one bad round".
export const WEAK_BAND = 2;
