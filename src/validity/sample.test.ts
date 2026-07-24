import { describe, expect, it } from "vitest";
import { seededSample } from "./sample";

const ITEMS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

describe("seededSample", () => {
  it("is deterministic for the same key", () => {
    expect(seededSample(ITEMS, 4, "k1")).toEqual(seededSample(ITEMS, 4, "k1"));
  });

  it("different keys give a different pick (on a set this size)", () => {
    const a = seededSample(ITEMS, 4, "k1");
    const b = seededSample(ITEMS, 4, "k2");
    expect(a.join()).not.toBe(b.join());
  });

  it("returns exactly count items with no duplicates", () => {
    const s = seededSample(ITEMS, 6, "k3");
    expect(s).toHaveLength(6);
    expect(new Set(s).size).toBe(6);
    for (const x of s) expect(ITEMS).toContain(x);
  });

  it("clamps count to the set size and floors at zero", () => {
    expect(seededSample(ITEMS, 99, "k4")).toHaveLength(ITEMS.length);
    expect(seededSample(ITEMS, 0, "k4")).toHaveLength(0);
    expect(seededSample(ITEMS, -3, "k4")).toHaveLength(0);
    expect(seededSample([], 5, "k4")).toHaveLength(0);
  });

  it("does not mutate the input", () => {
    const copy = [...ITEMS];
    seededSample(ITEMS, 5, "k5");
    expect(ITEMS).toEqual(copy);
  });
});
