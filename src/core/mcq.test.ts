import { describe, expect, it } from "vitest";
import { STRONG_SCORE } from "./constants";
import { gradeFromMcq } from "./mcq";
import { applyGrade, initTopicState } from "./policy";

describe("gradeFromMcq", () => {
  it("a correct pick pushes the estimate one step above the item and counts as strong", () => {
    const g = gradeFromMcq(true, 7);
    expect(g.demonstratedLevel).toBe(9); // 7 + step(2)
    expect(g.score).toBeGreaterThanOrEqual(STRONG_SCORE);
    expect(g.matchedCount).toBe(1);
    expect(g.missingCount).toBe(0);
    expect(g.degenerate).toBe(false);
  });

  it("a wrong pick pushes the estimate one step below the item and is not strong", () => {
    const g = gradeFromMcq(false, 7);
    expect(g.demonstratedLevel).toBe(5); // 7 - step(2)
    expect(g.score).toBeLessThan(STRONG_SCORE);
    expect(g.matchedCount).toBe(0);
    expect(g.missingCount).toBe(1);
  });

  it("clamps the demonstrated level to 1..10", () => {
    expect(gradeFromMcq(false, 2).demonstratedLevel).toBe(1); // 2 - 2, clamped up to 1
    expect(gradeFromMcq(true, 99).demonstratedLevel).toBe(10);
  });

  it("feeds the engine: correct picks climb theta and keep probing; a miss then converges", () => {
    let t = initTopicState({ name: "T", importance: 100, startLevel: 5 });
    t = applyGrade(t, gradeFromMcq(true, 8));
    t = applyGrade(t, gradeFromMcq(true, 8));
    expect(t.theta).toBeGreaterThan(5);
    expect(t.converged).toBe(false); // still climbing to find the ceiling
    t = applyGrade(t, gradeFromMcq(false, 9)); // misses a harder item, level is bracketed
    expect(t.converged).toBe(true);
  });
});
