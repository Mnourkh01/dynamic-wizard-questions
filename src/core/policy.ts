import {
  CEILING_PROBE_AFTER,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  DISCOVERY_LEVEL,
  GLOBAL_MAX_QUESTIONS,
  INITIAL_SIGMA,
  MAX_QUESTIONS_PER_TOPIC,
  MIN_QUESTIONS_PER_TOPIC,
  NOISE,
  SIGMA_FLOOR,
  SIGMA_THRESHOLD,
  START_THETA,
  STOP_STABLE_BANDS,
  STRONG_SCORE,
  TEXT_MIN_QUESTIONS,
  THETA_MAX,
  THETA_MIN,
  WEAK_SCORE,
} from "./constants";
import { clamp, clampLevel } from "./ladder";
import type {
  AssessmentMode,
  EngineDecision,
  Grade,
  TopicBlueprint,
  TopicState,
} from "./types";

// Build the starting state for a topic. The running estimate starts LOW, at the
// 101 opener level, and climbs only on evidence, so the difficulty is an organized
// ladder up from the bottom. startLevel is retained on the state but no longer
// steers the opener (everyone starts at 101 for a fair, organized climb).
export function initTopicState(bp: TopicBlueprint): TopicState {
  return {
    name: bp.name,
    importance: bp.importance,
    theta: START_THETA,
    sigma: INITIAL_SIGMA,
    startLevel: clamp(bp.startLevel, THETA_MIN, THETA_MAX),
    questionsAsked: 0,
    answeredCount: 0,
    consecutiveStrong: 0,
    converged: false,
    points: 0,
  };
}

// Deterministic confidence from how much of the rubric the answer actually hit.
// The Grader's self-reported confidence is intentionally NOT used here: a
// hallucinated high confidence on a wrong grade would collapse sigma and end the
// test early. Degenerate answers get the floor.
export function deterministicConfidence(grade: Grade): number {
  if (grade.degenerate) return CONFIDENCE_MIN;
  const denom = grade.matchedCount + grade.missingCount;
  const raw = denom > 0 ? grade.matchedCount / denom : 0.5;
  return clamp(raw, CONFIDENCE_MIN, CONFIDENCE_MAX);
}

// Kalman-style update of one topic from one grade. Pure: returns a new state.
export function applyGrade(topic: TopicState, grade: Grade): TopicState {
  const c = deterministicConfidence(grade);
  const K = topic.sigma / (topic.sigma + NOISE);
  // One-sided evidence gate (2026-07-24 calibration). An MCQ grade is censored
  // evidence, not a point estimate: a PASSING answer only proves ability at
  // least at the demonstrated level, so it may raise the estimate but never
  // lower it (the bank holds one item per level, so once the hard items are
  // used, a correct pick on an easy leftover used to drag a high estimate
  // down; that is what capped true seniors at ~730-820). A FAILING answer only
  // proves the ceiling, so it may lower the estimate but never raise it (a
  // wrong pick on a hard item used to pull weak candidates UP toward it, which
  // inflated lucky guessers; this also tightens the always-A gaming net).
  // Mid scores (WEAK_SCORE..STRONG_SCORE, free-text partial credit) keep the
  // symmetric move: for a graded written answer the demonstrated depth is a
  // real point estimate and may legitimately pull in either direction.
  const delta = grade.demonstratedLevel - topic.theta;
  const passing = grade.score >= STRONG_SCORE && !grade.degenerate;
  const failing = grade.score < WEAK_SCORE;
  // A depth reading of a written answer is a real point estimate, so it moves the
  // estimate in whichever direction it points. Only bracket evidence is gated.
  const gatedDelta = grade.measuresDepth
    ? delta
    : (passing && delta < 0) || (failing && delta > 0)
      ? 0
      : delta;
  const theta = clamp(topic.theta + K * c * gatedDelta, THETA_MIN, THETA_MAX);
  const sigma = Math.max(topic.sigma * (1 - K * c), SIGMA_FLOOR);
  const answeredCount = topic.answeredCount + 1;
  const consecutiveStrong =
    grade.score >= STRONG_SCORE && !grade.degenerate ? topic.consecutiveStrong + 1 : 0;

  const next: TopicState = {
    ...topic,
    theta,
    sigma,
    answeredCount,
    questionsAsked: Math.max(topic.questionsAsked, answeredCount),
    consecutiveStrong,
  };
  next.converged = isTopicConverged(next);
  return next;
}

export function isTopicConverged(topic: TopicState): boolean {
  // Hard per-topic cap always stops it.
  if (topic.answeredCount >= MAX_QUESTIONS_PER_TOPIC) return true;
  // Needs the minimum evidence first.
  if (topic.answeredCount < MIN_QUESTIONS_PER_TOPIC) return false;
  // Do not stop while the candidate is still on a winning streak below the top
  // band: their ceiling has not been found yet (this is what lets the MCQ
  // staircase climb instead of converging on the first two easy items). Converge
  // once the streak breaks (a miss brackets the level) or the estimate tops out.
  if (topic.consecutiveStrong >= CEILING_PROBE_AFTER && topic.theta < THETA_MAX - 1) {
    return false;
  }
  return topic.sigma < SIGMA_THRESHOLD;
}

// Difficulty for the next question in a topic that is already UNDERWAY
// (answeredCount > 0). The estimate started at the candidate's running ability and
// climbs or drops with each answer, so this is a smooth staircase, never a reset:
// a wrong answer lowers the level and continues, a right one nudges up. A ceiling
// probe fires one level up after a run of strong answers to find the top. All fast
// MCQ (depth was already read at the single warm-up).
export function nextDifficulty(topic: TopicState): {
  difficulty: number;
  ceilingProbe: boolean;
  format: "mcq" | "text";
} {
  const base = clampLevel(topic.theta);
  if (topic.consecutiveStrong >= CEILING_PROBE_AFTER) {
    return { difficulty: clamp(base + 1, THETA_MIN, THETA_MAX), ceilingProbe: true, format: "mcq" };
  }
  return { difficulty: base, ceilingProbe: false, format: "mcq" };
}

// The candidate's ability so far, averaged over topics that have been assessed. A
// fresh topic opens HERE (continuing at their level) instead of resetting to the
// warm-up floor. Falls back to the start level before anything is assessed.
export function runningAbility(topics: TopicState[]): number {
  const assessed = topics.filter((t) => t.answeredCount > 0);
  if (assessed.length === 0) return START_THETA;
  return assessed.reduce((sum, t) => sum + t.theta, 0) / assessed.length;
}

// Pick the next topic to ask. The fixed question budget is SPREAD across every
// topic so all areas get covered (the user must see strengths and weaknesses in
// each), instead of one topic hogging questions until it settles. Priority:
//   1. Continue a topic underway that is not settled AND still under its fair share.
//   2. Open the next unstarted topic, most important first.
//   3. All topics covered: spend the leftover questions on the least-covered topic,
//      tie-broken by highest uncertainty.
// Always returns a valid index while there are topics, so the ONLY thing that ends
// a session is the fixed question count.
export function selectTopicIndex(
  topics: TopicState[],
  maxQuestions: number = GLOBAL_MAX_QUESTIONS,
): number {
  if (topics.length === 0) return -1;

  // A topic's fair share of the budget, so every topic is reached: e.g. 25
  // questions over 7 topics is ~3 each before moving on (leftovers refine later).
  const softTarget = Math.max(
    MIN_QUESTIONS_PER_TOPIC,
    Math.floor(maxQuestions / topics.length),
  );

  let inProgress = -1;
  for (let i = 0; i < topics.length; i++) {
    const t = topics[i];
    if (!t.converged && t.answeredCount > 0 && t.answeredCount < softTarget) {
      if (inProgress === -1 || t.sigma > topics[inProgress].sigma) inProgress = i;
    }
  }
  if (inProgress !== -1) return inProgress;

  let unstarted = -1;
  for (let i = 0; i < topics.length; i++) {
    if (topics[i].answeredCount === 0) {
      if (unstarted === -1 || topics[i].importance > topics[unstarted].importance) unstarted = i;
    }
  }
  if (unstarted !== -1) return unstarted;

  // Every topic covered: spend the remaining questions on the least-covered topic
  // (balance), then highest uncertainty.
  let best = 0;
  for (let i = 1; i < topics.length; i++) {
    const t = topics[i];
    const b = topics[best];
    if (t.answeredCount < b.answeredCount || (t.answeredCount === b.answeredCount && t.sigma > b.sigma)) {
      best = i;
    }
  }
  return best;
}

// Whether the written interview has learned enough to end before its maximum.
// Deterministic and strict: enough answers AND the last few level readings
// identical. A senior holding band 5 across different question shapes is done at
// the minimum; any wobble, or an ungraded answer in the window, keeps the
// interview alive to the cap. Bands come from stored evaluations, oldest first,
// so a replayed or resumed session computes exactly the same verdict.
export function shouldStopEarly(
  totalAnswered: number,
  bands: Array<number | null>,
): boolean {
  if (totalAnswered < TEXT_MIN_QUESTIONS) return false;
  const window = bands.slice(-STOP_STABLE_BANDS);
  if (window.length < STOP_STABLE_BANDS) return false;
  if (window.some((b) => b === null)) return false;
  return new Set(window).size === 1;
}

// The single deterministic decision function. An MCQ session ALWAYS runs exactly
// GLOBAL_MAX_QUESTIONS questions (a full assessment), then reports; it never stops
// early on convergence. A text session may end early once the band reading has
// settled (shouldStopEarly). Only the very first question is a written warm-up;
// every later topic continues at the running ability (carried via seedTheta),
// never resetting to an easy warm-up.
export function decide(
  topics: TopicState[],
  totalAnswered: number,
  // The length THIS session was started with, read from its row. Defaulted so
  // existing callers and tests keep the module-level budget.
  maxQuestions: number = GLOBAL_MAX_QUESTIONS,
  // The mode THIS session was started in. In text mode every question after the
  // warm-up is written too, so the format never varies within a session.
  mode: AssessmentMode = "mcq",
  // Text mode only: the band of every graded answer so far, oldest first, read
  // from stored evaluations. Callers that do not pass it (MCQ paths, the resume
  // snapshot, older tests) never stop early, which is the safe default.
  bands?: Array<number | null>,
): EngineDecision {
  if (totalAnswered >= maxQuestions) return { kind: "done" };
  if (mode === "text" && bands && shouldStopEarly(totalAnswered, bands)) {
    return { kind: "done" };
  }
  const topicIndex = selectTopicIndex(topics, maxQuestions);
  if (topicIndex < 0) return { kind: "done" };
  const topic = topics[topicIndex];
  const continuingFormat = mode === "text" ? "text" : "mcq";

  if (topic.answeredCount === 0) {
    if (totalAnswered === 0) {
      // The one and only warm-up: a written 101 opener that reads the starting
      // depth so the whole assessment begins at the candidate's real level.
      return {
        kind: "ask",
        topicIndex,
        difficulty: DISCOVERY_LEVEL,
        ceilingProbe: false,
        discovery: true,
        format: "text",
      };
    }
    // Every later topic CONTINUES at the running ability (no warm-up reset).
    // seedTheta carries that level into the fresh topic.
    const seed = runningAbility(topics);
    return {
      kind: "ask",
      topicIndex,
      difficulty: clampLevel(seed),
      ceilingProbe: false,
      discovery: false,
      format: continuingFormat,
      seedTheta: seed,
    };
  }

  const { difficulty, ceilingProbe } = nextDifficulty(topic);
  return {
    kind: "ask",
    topicIndex,
    difficulty,
    ceilingProbe,
    discovery: false,
    format: continuingFormat,
  };
}
