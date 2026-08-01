import { describe, expect, it } from "vitest";
import { matchRubricPoints } from "./scanner";

// Regression for a live run that reported "133/100 coverage": the scanner had
// returned 4 matched entries against a 3 point rubric, and the count was taken
// straight from the array length. Code owns the number now.
const RUBRIC = [
  "Measures before changing anything, for example by reading the query plan",
  "Identifies why the current access path is slow, such as a sequential scan",
  "Proposes an index or query change that matches the actual filter",
];

describe("matchRubricPoints", () => {
  it("matches points copied verbatim", () => {
    expect(matchRubricPoints(RUBRIC, [{ point: RUBRIC[0] }, { point: RUBRIC[2] }])).toEqual([0, 2]);
  });

  it("counts a point once no matter how many times it is claimed", () => {
    const covered = matchRubricPoints(RUBRIC, [
      { point: RUBRIC[1] },
      { point: RUBRIC[1] },
      { point: "Identifies why the current access path is slow" },
    ]);
    expect(covered).toEqual([1]);
  });

  it("can never report more coverage than the rubric has points", () => {
    const claims = Array.from({ length: 9 }, (_, i) => ({ point: RUBRIC[i % 3] }));
    expect(matchRubricPoints(RUBRIC, claims).length).toBeLessThanOrEqual(RUBRIC.length);
  });

  it("matches a paraphrase that keeps the point's words", () => {
    const covered = matchRubricPoints(RUBRIC, [
      { point: "proposes an index change that matches the actual filter" },
    ]);
    expect(covered).toEqual([2]);
  });

  it("drops a claim that lands on no rubric point rather than attaching it to the nearest", () => {
    expect(matchRubricPoints(RUBRIC, [{ point: "mentions connection pooling and vacuum" }])).toEqual([]);
  });

  it("ignores punctuation and case differences", () => {
    const covered = matchRubricPoints(RUBRIC, [
      { point: "MEASURES BEFORE CHANGING ANYTHING, FOR EXAMPLE BY READING THE QUERY PLAN." },
    ]);
    expect(covered).toEqual([0]);
  });

  it("drops an empty claim", () => {
    expect(matchRubricPoints(RUBRIC, [{ point: "   " }])).toEqual([]);
  });

  it("returns nothing when the rubric is empty", () => {
    expect(matchRubricPoints([], [{ point: "anything" }])).toEqual([]);
  });

  it("works on Arabic rubric points", () => {
    const arabic = ["يوضح صح وببساطة إيه هو الفهرس", "يشرح إزاي بيشتغل في الواقع"];
    expect(matchRubricPoints(arabic, [{ point: arabic[1] }])).toEqual([1]);
  });

  it("matches an Arabic paraphrase built from short words", () => {
    // Arabic content words are routinely two or three characters, so any filter
    // that drops short words would silently stop matching in Arabic.
    const arabic = [
      "يوضح صح وببساطة إيه هو الفهرس",
      "يشرح إزاي بيشتغل في الواقع",
      "يذكر تكلفة الكتابة على الجدول",
    ];
    expect(matchRubricPoints(arabic, [{ point: "يشرح إزاي بيشتغل" }])).toEqual([1]);
    expect(matchRubricPoints(arabic, [{ point: "يذكر تكلفة الكتابة" }])).toEqual([2]);
  });

  it("attaches a claim to the most specific overlapping point, not the first", () => {
    const overlapping = [
      "identifies a slow query",
      "identifies a slow query and reads its execution plan",
    ];
    expect(matchRubricPoints(overlapping, [{ point: "identifies a slow query and reads its execution plan" }])).toEqual([1]);
    expect(matchRubricPoints(overlapping, [{ point: "identifies a slow query" }])).toEqual([0]);
  });

  it("does not let words common to every point carry a match on their own", () => {
    const rubric = [
      "explains how caching reduces database load",
      "explains how indexing reduces database load",
    ];
    // Shares only the words every point shares, so it identifies neither.
    expect(matchRubricPoints(rubric, [{ point: "explains how something reduces database load" }])).toEqual([]);
  });
});
