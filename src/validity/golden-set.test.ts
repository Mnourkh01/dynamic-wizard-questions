import { describe, expect, it } from "vitest";
import { GOLDEN_SET, isInjectionItem } from "./golden-set";

// Pure structural checks on the golden set: the coverage contract the golden
// validity mode relies on. No AI, no I/O.
describe("golden set", () => {
  const byBand = (band: string) => GOLDEN_SET.filter((g) => g.expectedBand === band);

  it("meets the size and band coverage minimums", () => {
    expect(GOLDEN_SET.length).toBeGreaterThanOrEqual(24);
    expect(byBand("senior").length).toBeGreaterThanOrEqual(6);
    expect(byBand("mid").length).toBeGreaterThanOrEqual(6);
    expect(byBand("junior").length).toBeGreaterThanOrEqual(4);
    expect(byBand("junk").length).toBeGreaterThanOrEqual(4);
  });

  it("has at least 3 Arabic answers", () => {
    expect(GOLDEN_SET.filter((g) => g.language === "ar").length).toBeGreaterThanOrEqual(3);
  });

  it("flags exactly the prompt-injection items, all of them junk", () => {
    const injections = GOLDEN_SET.filter(isInjectionItem);
    expect(injections.length).toBeGreaterThanOrEqual(2);
    for (const item of injections) expect(item.expectedBand).toBe("junk");
    // The SQL injection QUESTION must not trip the detector: only notes that
    // start with "prompt injection" count.
    const sqlItems = GOLDEN_SET.filter(
      (g) => g.question.includes("SQL injection") && g.expectedBand !== "junk",
    );
    expect(sqlItems.length).toBeGreaterThan(0);
    for (const item of sqlItems) expect(isInjectionItem(item)).toBe(false);
  });

  it("every item is complete", () => {
    for (const g of GOLDEN_SET) {
      expect(g.question.length).toBeGreaterThan(0);
      expect(g.rubricPoints.length).toBeGreaterThanOrEqual(2);
      expect(g.gold.length).toBeGreaterThan(0);
      expect(g.answer.length).toBeGreaterThan(0);
      expect(g.note.length).toBeGreaterThan(0);
    }
  });

  it("contains no em-dash or en-dash anywhere", () => {
    const blob = JSON.stringify(GOLDEN_SET);
    expect(blob).not.toMatch(/[\u2013\u2014]/);
  });
});
