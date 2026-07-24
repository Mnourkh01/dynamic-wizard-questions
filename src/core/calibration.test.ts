import { describe, expect, it } from "vitest";
import { GLOBAL_MAX_QUESTIONS } from "./constants";
import { gradeFromMcq } from "./mcq";
import { applyGrade } from "./policy";
import {
  degenerateWarmupGrade,
  knowledgeBoundary,
  noisyKnowledge,
  simulateSession,
  takeNearestItem,
  warmupGrade,
} from "./simulate";
import type { TopicState } from "./types";

// Permanent calibration net for the deterministic engine. Simulates full
// 25-question sessions (1 written warm-up + 24 bank MCQs across 7 topics)
// through the REAL decide/gradeFromMcq/applyGrade/computeFinalScore pipeline,
// with zero AI and zero I/O, and pins the L-to-score curve to bands.
//
// Calibration record (2026-07-24). Deterministic candidate (knows everything
// at or below true level L, nothing above), then mean of 3 seeded noisy runs
// (25% lucky guess above L, 10% careless miss at or below L):
//
//   L   | before (sym) | after (gated) | noisy mean before -> after
//   ----+--------------+---------------+---------------------------
//   2   | 338          | 328           | 460 -> 457
//   4   | 485          | 512           | 518 -> 538
//   6   | 617          | 625           | 672 -> 691
//   8   | 733          | 809           | 735 -> 795
//   10  | 820          | 946           | 804 -> 907
//   A*  | 385          | 312           | (locked always-A regression test)
//
// The single change that landed the bands: the one-sided evidence gate in
// applyGrade (policy.ts). Before it, a correct pick on an easy leftover bank
// item (served because the topic's one item per harder level was already
// used) DRAGGED a high estimate down, capping true seniors at ~730-820, and a
// wrong pick on a hard item PULLED weak candidates up toward it, inflating
// lucky guessers. MCQ_LEVEL_STEP, the theta-to-points map, confidence bounds,
// and the convergence rules are all pinned by existing tests and did not need
// to move.
//
// The bands below are the tolerance: every simulation here is fully
// deterministic (fixed seeds), so this test can never flake; it only fails if
// the engine's curve actually moves out of a band.

const LEVELS = [2, 4, 6, 8, 10];
const SEEDS = ["cal-seed-1", "cal-seed-2", "cal-seed-3"];

function deterministicTotal(L: number): number {
  return simulateSession({ warmup: warmupGrade(L), answers: knowledgeBoundary(L) }).final
    .total;
}

function noisyTotals(L: number): number[] {
  return SEEDS.map(
    (s) =>
      simulateSession({
        warmup: warmupGrade(L),
        answers: noisyKnowledge(L, `${s}:L${L}`),
      }).final.total,
  );
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// The bands are calibrated for the default full session. A run with
// MAX_QUESTIONS overridden (short/cheap e2e runs) changes the budget the
// engine spreads over topics, so the curve legitimately differs there.
describe.skipIf(GLOBAL_MAX_QUESTIONS !== 25)(
  "engine calibration net (25 questions, 7 topics)",
  () => {
    it("mirrors the live loop shape: full budget spent, warm-up plus 24 MCQs, every topic assessed", () => {
      const run = simulateSession({ warmup: warmupGrade(6), answers: knowledgeBoundary(6) });
      expect(run.totalAnswered).toBe(GLOBAL_MAX_QUESTIONS);
      expect(run.mcqCount).toBe(GLOBAL_MAX_QUESTIONS - 1); // one written warm-up
      expect(run.topics).toHaveLength(7);
      for (const t of run.topics) expect(t.answeredCount).toBeGreaterThanOrEqual(3);
      for (const t of run.final.topics) expect(t.label).not.toBe("not assessed");
    });

    it("deterministic candidates land their bands (L=2: 328, L=4: 512, L=6: 625, L=8: 809, L=10: 946)", () => {
      const l2 = simulateSession({ warmup: warmupGrade(2), answers: knowledgeBoundary(2) });
      expect(l2.final.total).toBeLessThanOrEqual(400);
      expect(l2.final.overallLabel).toBe("Beginner");

      const l4 = deterministicTotal(4);
      expect(l4).toBeGreaterThan(400);
      expect(l4).toBeLessThanOrEqual(550);

      const l6 = simulateSession({ warmup: warmupGrade(6), answers: knowledgeBoundary(6) });
      expect(l6.final.total).toBeGreaterThan(550);
      expect(l6.final.total).toBeLessThanOrEqual(700);
      expect(l6.final.overallLabel).toBe("Intermediate");

      const l8 = simulateSession({ warmup: warmupGrade(8), answers: knowledgeBoundary(8) });
      expect(l8.final.total).toBeGreaterThan(700);
      expect(l8.final.total).toBeLessThanOrEqual(850);
      expect(l8.final.overallLabel).toBe("Advanced");

      const l10 = simulateSession({ warmup: warmupGrade(10), answers: knowledgeBoundary(10) });
      expect(l10.final.total).toBeGreaterThanOrEqual(850);
      expect(l10.final.overallLabel).toBe("Advanced");
    });

    it("the deterministic curve is strictly monotonic in true level", () => {
      const totals = LEVELS.map(deterministicTotal);
      for (let i = 1; i < totals.length; i++) {
        expect(totals[i]).toBeGreaterThan(totals[i - 1]);
      }
    });

    it("noisy candidates (3 seeds each) stay near their bands and strictly monotonic on the mean", () => {
      // Noise tolerance: 25% lucky guessing over only 24 items is genuinely
      // worth points (and 10% careless misses cost some), so the noisy means
      // sit near, not exactly inside, the deterministic bands. Recorded means:
      // 457 / 538 / 691 / 795 / 907.
      const means = LEVELS.map((L) => mean(noisyTotals(L)));
      for (let i = 1; i < means.length; i++) {
        expect(means[i]).toBeGreaterThan(means[i - 1]);
      }
      expect(means[0]).toBeLessThanOrEqual(520); // L=2: luck ceiling, see tension note
      expect(means[1]).toBeGreaterThan(400);
      expect(means[1]).toBeLessThanOrEqual(620); // L=4
      expect(means[2]).toBeGreaterThan(550);
      expect(means[2]).toBeLessThanOrEqual(750); // L=6
      expect(means[3]).toBeGreaterThan(700);
      expect(means[3]).toBeLessThanOrEqual(870); // L=8
      expect(means[4]).toBeGreaterThanOrEqual(850); // L=10

      // Per-seed guardrails at the extremes.
      for (const t of noisyTotals(2)) expect(t).toBeLessThanOrEqual(550);
      for (const t of noisyTotals(10)) expect(t).toBeGreaterThanOrEqual(850);
    });

    it("a zero-knowledge lucky guesser (always-A style) stays under 500 and never Advanced", () => {
      // Complements the locked always-a regression test: same strategy, but
      // through the REAL adaptive loop (staircase difficulty + bank depletion)
      // instead of a fixed level cycle. Recorded totals: 467 / 378 / 378.
      for (const s of SEEDS) {
        const run = simulateSession({
          warmup: degenerateWarmupGrade(),
          answers: noisyKnowledge(0, `${s}:gamer`),
        });
        expect(run.corrects / run.mcqCount).toBeLessThan(0.5);
        expect(run.final.total).toBeLessThan(500);
        expect(run.final.overallLabel).not.toMatch(/advanced/i);
      }
    });
  },
);

describe("one-sided evidence gate in applyGrade", () => {
  const topic = (overrides: Partial<TopicState> = {}): TopicState => ({
    name: "T",
    importance: 100,
    theta: 5,
    sigma: 1,
    startLevel: 5,
    questionsAsked: 0,
    answeredCount: 0,
    consecutiveStrong: 0,
    converged: false,
    points: 0,
    ...overrides,
  });

  it("a passing answer never lowers the estimate (easy leftover item cannot drag a senior down)", () => {
    // Correct MCQ at level 4 demonstrates level 6; a theta-8 topic must hold.
    const next = applyGrade(topic({ theta: 8 }), gradeFromMcq(true, 4));
    expect(next.theta).toBe(8);
    // The observation still counts as confirming evidence: sigma shrinks.
    expect(next.sigma).toBeLessThan(1);
    expect(next.consecutiveStrong).toBe(1);
  });

  it("a failing answer never raises the estimate (hard item cannot pull a guesser up)", () => {
    // Wrong MCQ at level 9 demonstrates level 7; a theta-2 topic must hold.
    const next = applyGrade(topic({ theta: 2 }), gradeFromMcq(false, 9));
    expect(next.theta).toBe(2);
    expect(next.sigma).toBeLessThan(1);
    expect(next.consecutiveStrong).toBe(0);
  });

  it("passing still climbs and failing still drops (the gate is one-sided, not a freeze)", () => {
    const up = applyGrade(topic({ theta: 5 }), gradeFromMcq(true, 7));
    expect(up.theta).toBeGreaterThan(5);
    const down = applyGrade(topic({ theta: 5 }), gradeFromMcq(false, 4));
    expect(down.theta).toBeLessThan(5);
  });

  it("mid-score free-text keeps the symmetric move in both directions", () => {
    const midDown = applyGrade(topic({ theta: 6 }), {
      score: 60,
      demonstratedLevel: 4,
      matchedCount: 2,
      missingCount: 2,
      degenerate: false,
    });
    expect(midDown.theta).toBeLessThan(6); // partial credit may pull down
    const midUp = applyGrade(topic({ theta: 6 }), {
      score: 60,
      demonstratedLevel: 8,
      matchedCount: 2,
      missingCount: 2,
      degenerate: false,
    });
    expect(midUp.theta).toBeGreaterThan(6); // and up
  });
});

describe("simulator internals", () => {
  it("takeNearestItem serves the nearest level, ties to the lower, depletes, then falls back to the difficulty", () => {
    const pool = [2, 4, 5, 7, 9];
    expect(takeNearestItem(pool, 6)).toBe(5); // tie 5 vs 7 -> lower (bank insertion order)
    expect(takeNearestItem(pool, 6)).toBe(7); // 5 is used up now
    expect(takeNearestItem(pool, 6)).toBe(4);
    expect(takeNearestItem(pool, 10)).toBe(9);
    expect(takeNearestItem(pool, 1)).toBe(2);
    expect(pool).toHaveLength(0);
    expect(takeNearestItem(pool, 6)).toBe(6); // live single-MCQ fallback
    expect(takeNearestItem(pool, 99)).toBe(10); // clamped
  });

  it("warmupGrade maps depth like the grader: strong only from level 6 up, confidence input scales with L", () => {
    expect(warmupGrade(2).score).toBe(52);
    expect(warmupGrade(4).score).toBe(64);
    expect(warmupGrade(6).score).toBe(76); // first strong warm-up
    expect(warmupGrade(10).score).toBe(100);
    for (const L of LEVELS) {
      const g = warmupGrade(L);
      expect(g.demonstratedLevel).toBe(L);
      expect(g.matchedCount + g.missingCount).toBe(10);
      expect(g.degenerate).toBe(false);
    }
    expect(degenerateWarmupGrade().degenerate).toBe(true);
    expect(degenerateWarmupGrade().score).toBe(0);
  });
});
