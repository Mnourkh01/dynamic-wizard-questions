import { describe, expect, it } from "vitest";
import { computeFinalScore, normalizeWeightsTo1000 } from "./scoring";
import type { TopicState } from "./types";

function topic(name: string, weight: number, theta: number, sigma = 0.5): TopicState {
  return {
    name,
    weight,
    theta,
    sigma,
    firstPickPrior: 5,
    questionsAsked: 3,
    answeredCount: 3,
    consecutiveStrong: 0,
    converged: true,
    points: 0,
  };
}

describe("normalizeWeightsTo1000", () => {
  it("always sums to exactly 1000", () => {
    const cases = [
      [1, 1, 1],
      [3, 3, 3],
      [10, 20, 30, 40],
      [1, 2, 3, 4, 5, 6, 7],
      [100],
      [7, 7, 7, 7, 7, 7],
    ];
    for (const c of cases) {
      const out = normalizeWeightsTo1000(c);
      expect(out.reduce((a, b) => a + b, 0)).toBe(1000);
    }
  });

  it("keeps proportions and hands remainders to the largest fractions", () => {
    // three equal weights => 334/333/333 in some order summing to 1000
    const out = normalizeWeightsTo1000([1, 1, 1]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(Math.max(...out) - Math.min(...out)).toBeLessThanOrEqual(1);
  });

  it("gives a single topic all 1000", () => {
    expect(normalizeWeightsTo1000([42])).toEqual([1000]);
  });

  it("handles all-zero / invalid input by spreading evenly to 1000", () => {
    const out = normalizeWeightsTo1000([0, 0, 0, 0]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(out.every((v) => v === 250)).toBe(true);
  });

  it("returns empty for empty input", () => {
    expect(normalizeWeightsTo1000([])).toEqual([]);
  });
});

describe("computeFinalScore", () => {
  it("computes per-topic points as round(weight * theta/10) and totals them", () => {
    const topics = [topic("A", 500, 8), topic("B", 300, 5), topic("C", 200, 10)];
    const score = computeFinalScore(topics);
    // 500*0.8=400, 300*0.5=150, 200*1.0=200 => 750
    expect(score.topics.map((t) => t.points)).toEqual([400, 150, 200]);
    expect(score.total).toBe(750);
    expect(score.total).toBe(score.topics.reduce((s, t) => s + t.points, 0));
  });

  it("labels the headline with the three-tier depth tier from the total", () => {
    // total 1000 => 100% => Advanced
    expect(computeFinalScore([topic("A", 1000, 10)]).overallLabel).toBe("Advanced");
    // total 100 => 10% => Beginner
    expect(computeFinalScore([topic("A", 1000, 1)]).overallLabel).toBe("Beginner");
    // total ~600 => 60% => Intermediate
    expect(computeFinalScore([topic("A", 1000, 6)]).overallLabel).toBe("Intermediate");
  });

  it("produces a non-negative confidence band that grows with sigma", () => {
    const tight = computeFinalScore([topic("A", 1000, 6, 0.35)]);
    const wide = computeFinalScore([topic("A", 1000, 6, 2.0)]);
    expect(tight.confidenceInterval).toBeGreaterThanOrEqual(0);
    expect(wide.confidenceInterval).toBeGreaterThan(tight.confidenceInterval);
  });
});
