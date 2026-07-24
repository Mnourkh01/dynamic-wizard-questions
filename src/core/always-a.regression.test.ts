import { describe, expect, it } from "vitest";
import { gradeFromMcq } from "./mcq";
import { applyGrade, initTopicState } from "./policy";
import { computeFinalScore, normalizeImportanceTo1000 } from "./scoring";
import { shuffleMcqOptions } from "./shuffle";

// Regression net for the 2026-07-24 gaming bug: the MCQ generator puts the
// correct option first ~76% of the time, and options used to be served
// verbatim, so a candidate who ALWAYS clicked option A scored 916/1000
// "Advanced" with zero knowledge. This test replays that exact strategy
// through the real deterministic pipeline (shuffle -> gradeFromMcq ->
// applyGrade -> computeFinalScore) and pins the outcome to guess level.
// If anyone removes or weakens the serve-time shuffle, this fails loudly.

const OPTIONS = ["opt a", "opt b", "opt c", "opt d"];
const BANK_LEVELS = [2, 4, 5, 7, 9];
const TOPIC_COUNT = 6;
const QUESTIONS = 24;

describe("always-A gaming regression", () => {
  it("always picking option A lands at guess level, not Advanced", () => {
    const importances = normalizeImportanceTo1000(
      Array.from({ length: TOPIC_COUNT }, () => 1),
    );
    let topics = importances.map((importance, i) =>
      initTopicState({ name: `topic-${i}`, importance, startLevel: 3 }),
    );

    let corrects = 0;
    for (let q = 0; q < QUESTIONS; q++) {
      const topicIndex = q % TOPIC_COUNT;
      // Generator bias reproduced: the correct answer arrives at index 0.
      const served = shuffleMcqOptions(`gaming-session:${q}:stem-${q}`, OPTIONS, 0);
      const level = BANK_LEVELS[q % BANK_LEVELS.length];
      const correct = served.correctIndex === 0; // the candidate always clicks A
      if (correct) corrects++;
      topics = topics.map((t, i) =>
        i === topicIndex ? applyGrade(t, gradeFromMcq(correct, level)) : t,
      );
    }

    const final = computeFinalScore(topics);

    // Four options: pure guessing is 25%. Deterministic keys make the exact
    // count stable; keep a generous binomial band so key tweaks do not flap.
    expect(corrects / QUESTIONS).toBeGreaterThan(0.04);
    expect(corrects / QUESTIONS).toBeLessThan(0.5);

    // The bug scored 916/1000 "Advanced". Guess-level play must stay far
    // below that; the verified live run after the fix scored 351.
    expect(final.total).toBeLessThan(500);
    expect(final.overallLabel).not.toMatch(/advanced/i);
  });

  it("a candidate who actually knows the answers still scores high", () => {
    // Sanity twin: the shuffle must not hurt a genuine expert. Same pipeline,
    // but the candidate clicks the CORRECT shuffled position every time.
    const importances = normalizeImportanceTo1000(
      Array.from({ length: TOPIC_COUNT }, () => 1),
    );
    let topics = importances.map((importance, i) =>
      initTopicState({ name: `topic-${i}`, importance, startLevel: 3 }),
    );

    for (let q = 0; q < QUESTIONS; q++) {
      const topicIndex = q % TOPIC_COUNT;
      const level = BANK_LEVELS[q % BANK_LEVELS.length];
      topics = topics.map((t, i) =>
        i === topicIndex ? applyGrade(t, gradeFromMcq(true, level)) : t,
      );
    }

    const final = computeFinalScore(topics);
    expect(final.total).toBeGreaterThan(600);
  });
});
