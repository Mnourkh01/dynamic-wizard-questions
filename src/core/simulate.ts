// Pure calibration simulator. Mirrors the orchestrator loop in
// src/orchestrator/session.ts step by step, with ZERO I/O and ZERO AI calls, so
// the engine's L-to-score curve can be measured and pinned by tests.
//
// Faithful mirror of the live loop:
//   1. decide() picks the topic + difficulty (the very first ask is the written
//      101 warm-up; every later fresh topic is seeded with the running ability
//      exactly like continueSession writes decision.seedTheta to the DB).
//   2. The MCQ item is pulled from a per-topic bank pool holding ONE item per
//      level in BANK_LEVELS, inserted in ascending order, marked used when
//      served, nearest-to-difficulty with ties going to the LOWER level. That is
//      exactly what pickBankMcq does over the pre-seeded role banks (5 rows per
//      topic; a stable sort keeps ascending insertion order on distance ties).
//      An exhausted pool falls back to an item at the requested difficulty, like
//      the live single-MCQ fallback.
//   3. The answer model decides correct/wrong, gradeFromMcq turns that into a
//      Grade at the SERVED item level (session.ts grades at rubric.level), and
//      applyGrade updates the topic.
//   4. The loop ends only when decide() returns done (the fixed question
//      budget), then computeFinalScore produces the 1000-point headline.
import { clamp, clampLevel } from "./ladder";
import { gradeFromMcq } from "./mcq";
import { applyGrade, decide, initTopicState } from "./policy";
import { computeFinalScore, normalizeImportanceTo1000 } from "./scoring";
import { rngFromKey } from "./shuffle";
import type { FinalScore, Grade, TopicState } from "./types";

// The only levels the pre-generated MCQ bank holds (see scripts/gen-role-banks).
export const BANK_LEVELS: readonly number[] = [2, 4, 5, 7, 9];

// Answers one MCQ: given the served item's level, was the pick correct?
export type AnswerModel = (itemLevel: number) => boolean;

// Deterministic knowledge boundary: the candidate knows everything at or below
// their true level and nothing above it.
export function knowledgeBoundary(trueLevel: number): AnswerModel {
  return (itemLevel) => itemLevel <= trueLevel;
}

// Probabilistic variant: 25% lucky guess above the true level (4-option MCQ),
// 10% careless miss at or below it. Seeded, so every run is reproducible.
export function noisyKnowledge(
  trueLevel: number,
  seedKey: string,
  luckyGuess = 0.25,
  carelessMiss = 0.1,
): AnswerModel {
  const rand = rngFromKey(seedKey);
  return (itemLevel) =>
    itemLevel <= trueLevel ? rand() >= carelessMiss : rand() < luckyGuess;
}

// The grade the written 101 warm-up produces for a candidate of true level L,
// shaped like the grader agent's output:
//   - demonstratedLevel = the depth the answer actually shows = L (the grader's
//     whole job is reading depth from the opener).
//   - score grows with depth and is "strong" (>= STRONG_SCORE = 75) only from
//     L=6 up: 40 + 6L gives 52 / 64 / 76 / 88 / 100 for L = 2/4/6/8/10.
//   - matched/missing mirror how much of a 10-point rubric that depth covers,
//     so deterministicConfidence() lands at clamp(L/10, 0.3, 0.8).
export function warmupGrade(trueLevel: number): Grade {
  const lvl = clampLevel(trueLevel);
  return {
    score: clamp(40 + 6 * lvl, 0, 100),
    demonstratedLevel: lvl,
    matchedCount: lvl,
    missingCount: 10 - lvl,
    degenerate: false,
  };
}

// A zero-effort warm-up (empty / gibberish), exactly what classifyAnswer feeds
// the engine for a degenerate opener: score 0, floor level, floor confidence.
export function degenerateWarmupGrade(): Grade {
  return { score: 0, demonstratedLevel: 1, matchedCount: 0, missingCount: 5, degenerate: true };
}

export interface SimulateOptions {
  topicCount?: number; // default 7, the typical blueprint size
  warmup: Grade; // grade of the single written opener
  answers: AnswerModel; // how the candidate handles each served MCQ
}

export interface SimulatedSession {
  final: FinalScore;
  totalAnswered: number;
  mcqCount: number;
  corrects: number;
  topics: TopicState[];
}

// Serve the nearest remaining bank item to the requested difficulty and remove
// it from the pool (pickBankMcq marks rows used). Ties go to the LOWER level:
// the bank inserts rows in ascending level order and pickBankMcq's stable sort
// keeps insertion order among equal distances. An empty pool means the live
// single-MCQ fallback, which generates at the requested difficulty.
export function takeNearestItem(pool: number[], difficulty: number): number {
  if (pool.length === 0) return clampLevel(difficulty);
  let best = 0;
  for (let i = 1; i < pool.length; i++) {
    if (Math.abs(pool[i] - difficulty) < Math.abs(pool[best] - difficulty)) best = i;
  }
  const level = pool[best];
  pool.splice(best, 1);
  return level;
}

export function simulateSession(opts: SimulateOptions): SimulatedSession {
  const topicCount = opts.topicCount ?? 7;
  const importances = normalizeImportanceTo1000(
    Array.from({ length: topicCount }, () => 1),
  );
  let topics = importances.map((importance, i) =>
    initTopicState({ name: `topic-${i + 1}`, importance, startLevel: 3 }),
  );
  const pools = topics.map(() => [...BANK_LEVELS]);

  let totalAnswered = 0;
  let mcqCount = 0;
  let corrects = 0;

  for (;;) {
    const decision = decide(topics, totalAnswered);
    if (decision.kind !== "ask") break;

    let topic = topics[decision.topicIndex];
    // continueSession writes seedTheta into a fresh topic before asking, so the
    // topic continues at the running ability instead of the warm-up floor.
    if (decision.seedTheta !== undefined && topic.answeredCount === 0) {
      topic = { ...topic, theta: decision.seedTheta };
    }

    let grade: Grade;
    if (decision.format === "text") {
      grade = opts.warmup; // the single written 101 opener
    } else {
      const itemLevel = takeNearestItem(pools[decision.topicIndex], decision.difficulty);
      const correct = opts.answers(itemLevel);
      mcqCount += 1;
      if (correct) corrects += 1;
      grade = gradeFromMcq(correct, itemLevel);
    }

    const updated = applyGrade(topic, grade);
    topics = topics.map((t, i) => (i === decision.topicIndex ? updated : t));
    totalAnswered += 1;
  }

  return {
    final: computeFinalScore(topics),
    totalAnswered,
    mcqCount,
    corrects,
    topics,
  };
}
