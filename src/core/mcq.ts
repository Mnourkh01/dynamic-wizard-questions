import { THETA_MAX, THETA_MIN } from "./constants";
import { clamp } from "./ladder";
import type { Grade } from "./types";

// Deterministic grade for a multiple-choice answer. No AI: the whole speed win of
// the hybrid mode is that MCQ scoring is pure code, exactly where the project says
// "code owns every number."
//
// Unlike free-text (where the DEPTH of one answer reveals the level directly), a
// correct MCQ only proves ability is AT LEAST the item's level. So a correct pick
// pushes the estimate one step ABOVE the item and a wrong pick one step BELOW it:
// consecutive rounds then form an adaptive staircase that climbs to the candidate's
// true level and brackets it, instead of pinning the estimate to easy early items.

export const MCQ_CORRECT_SCORE = 90; // >= STRONG_SCORE so a correct pick counts as strong
export const MCQ_WRONG_SCORE = 20;
export const MCQ_LEVEL_STEP = 2;

// A well-formed MCQ has at least two options and a correct index that points at
// one of them. Used to DROP malformed agent output rather than silently defaulting
// the correct answer to option 0 (which would mark a wrong option as correct).
export function isValidMcq(options: unknown, correctIndex: unknown): options is string[] {
  return (
    Array.isArray(options) &&
    options.length >= 2 &&
    options.every((o) => typeof o === "string" && o.length > 0) &&
    Number.isInteger(correctIndex) &&
    (correctIndex as number) >= 0 &&
    (correctIndex as number) < options.length
  );
}

export function gradeFromMcq(correct: boolean, level: number): Grade {
  const lvl = clamp(Math.round(level), THETA_MIN, THETA_MAX);
  if (correct) {
    return {
      score: MCQ_CORRECT_SCORE,
      demonstratedLevel: clamp(lvl + MCQ_LEVEL_STEP, THETA_MIN, THETA_MAX),
      matchedCount: 1,
      missingCount: 0,
      degenerate: false,
    };
  }
  return {
    score: MCQ_WRONG_SCORE,
    demonstratedLevel: clamp(lvl - MCQ_LEVEL_STEP, THETA_MIN, THETA_MAX),
    matchedCount: 0,
    missingCount: 1,
    degenerate: false,
  };
}
