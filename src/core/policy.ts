import {
  CEILING_PROBE_AFTER,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  DISCOVERY_LEVEL,
  GLOBAL_MAX_QUESTIONS,
  INITIAL_SIGMA,
  MAX_QUESTIONS_PER_TOPIC,
  MIN_QUESTIONS_PER_TOPIC,
  NEUTRAL_START_THETA,
  NOISE,
  SIGMA_FLOOR,
  SIGMA_THRESHOLD,
  STRONG_SCORE,
  THETA_MAX,
  THETA_MIN,
} from "./constants";
import { clamp, clampLevel } from "./ladder";
import type { EngineDecision, Grade, TopicBlueprint, TopicState } from "./types";

// Build the starting state for a topic. The running estimate starts neutral;
// the prior is stored separately and only steers the first question.
export function initTopicState(bp: TopicBlueprint): TopicState {
  return {
    name: bp.name,
    weight: bp.weight,
    theta: NEUTRAL_START_THETA,
    sigma: INITIAL_SIGMA,
    firstPickPrior: clamp(bp.prior, THETA_MIN, THETA_MAX),
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
  const theta = clamp(
    topic.theta + K * c * (grade.demonstratedLevel - topic.theta),
    THETA_MIN,
    THETA_MAX,
  );
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
  // Otherwise it needs the minimum evidence AND low uncertainty.
  return topic.answeredCount >= MIN_QUESTIONS_PER_TOPIC && topic.sigma < SIGMA_THRESHOLD;
}

// Difficulty for the next question in a topic. The FIRST question of every topic
// is a broad discovery question (calibration), regardless of the persona prior.
// After that it tracks the live estimate, with a ceiling probe one level up after
// a run of strong answers. A deep discovery answer moves the estimate up sharply,
// so the second question fast-forwards to a hard one on its own.
export function nextDifficulty(topic: TopicState): {
  difficulty: number;
  ceilingProbe: boolean;
  discovery: boolean;
} {
  if (topic.answeredCount === 0) {
    return { difficulty: DISCOVERY_LEVEL, ceilingProbe: false, discovery: true };
  }
  const base = clampLevel(topic.theta);
  if (topic.consecutiveStrong >= CEILING_PROBE_AFTER) {
    return {
      difficulty: clamp(base + 1, THETA_MIN, THETA_MAX),
      ceilingProbe: true,
      discovery: false,
    };
  }
  return { difficulty: base, ceilingProbe: false, discovery: false };
}

// Pick the next topic to probe: the one we know least about (highest sigma),
// tie-broken by weight (spend questions where they matter most).
export function selectTopicIndex(topics: TopicState[]): number {
  let best = -1;
  for (let i = 0; i < topics.length; i++) {
    const t = topics[i];
    if (t.converged) continue;
    if (best === -1) {
      best = i;
      continue;
    }
    const b = topics[best];
    if (t.sigma > b.sigma || (t.sigma === b.sigma && t.weight > b.weight)) {
      best = i;
    }
  }
  return best;
}

// The single deterministic decision function. Given current topic states and how
// many questions have been answered overall, decide whether to ask (and what) or
// stop. Note: no gameable "senior ceiling" early stop; sessions end on full
// convergence or the global cap.
export function decide(topics: TopicState[], totalAnswered: number): EngineDecision {
  if (totalAnswered >= GLOBAL_MAX_QUESTIONS) return { kind: "done" };
  const topicIndex = selectTopicIndex(topics);
  if (topicIndex < 0) return { kind: "done" };
  const { difficulty, ceilingProbe, discovery } = nextDifficulty(topics[topicIndex]);
  return { kind: "ask", topicIndex, difficulty, ceilingProbe, discovery };
}
