import { describe, expect, it } from "vitest";
import { seedFromKey, shuffleMcqOptions } from "./shuffle";

const OPTIONS = ["alpha", "bravo", "charlie", "delta"];

describe("shuffleMcqOptions", () => {
  it("is deterministic for the same key", () => {
    const a = shuffleMcqOptions("session1:3:What is X?", OPTIONS, 0);
    const b = shuffleMcqOptions("session1:3:What is X?", OPTIONS, 0);
    expect(a).toEqual(b);
  });

  it("keeps the same set of options (permutation, no loss)", () => {
    const out = shuffleMcqOptions("any-key", OPTIONS, 2);
    expect([...out.options].sort()).toEqual([...OPTIONS].sort());
  });

  it("remaps correctIndex to the correct option's new position", () => {
    for (let orig = 0; orig < OPTIONS.length; orig++) {
      for (let k = 0; k < 50; k++) {
        const out = shuffleMcqOptions(`key-${k}`, OPTIONS, orig);
        expect(out.options[out.correctIndex]).toBe(OPTIONS[orig]);
      }
    }
  });

  it("spreads the correct answer near-uniformly across positions", () => {
    // The whole point of the fix: with correctIndex always 0 coming in (the
    // generator bias), the served position must be close to uniform.
    const counts = [0, 0, 0, 0];
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      const out = shuffleMcqOptions(`session-${i}:q:${i}`, OPTIONS, 0);
      counts[out.correctIndex]++;
    }
    for (const c of counts) {
      // Uniform would be 25%; require every position to land in 18%-32%.
      expect(c / runs).toBeGreaterThan(0.18);
      expect(c / runs).toBeLessThan(0.32);
    }
  });

  it("handles 2-option and 5-option questions", () => {
    const two = shuffleMcqOptions("k2", ["yes", "no"], 1);
    expect(two.options[two.correctIndex]).toBe("no");
    const fiveOpts = ["a", "b", "c", "d", "e"];
    const five = shuffleMcqOptions("k5", fiveOpts, 4);
    expect(five.options[five.correctIndex]).toBe("e");
    expect([...five.options].sort()).toEqual([...fiveOpts].sort());
  });

  it("different keys produce different orders (variety exists)", () => {
    const orders = new Set<string>();
    for (let i = 0; i < 24; i++) {
      orders.add(shuffleMcqOptions(`vary-${i}`, OPTIONS, 0).options.join("|"));
    }
    // 4 options have 24 permutations; 24 random keys must hit well more than 1.
    expect(orders.size).toBeGreaterThan(5);
  });

  it("seedFromKey is stable and 32-bit unsigned", () => {
    expect(seedFromKey("abc")).toBe(seedFromKey("abc"));
    expect(seedFromKey("abc")).not.toBe(seedFromKey("abd"));
    expect(seedFromKey("x")).toBeGreaterThanOrEqual(0);
    expect(seedFromKey("x")).toBeLessThanOrEqual(0xffffffff);
  });
});
