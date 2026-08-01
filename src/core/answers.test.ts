import { describe, expect, it } from "vitest";
import { normalizeForScan, stripTrailingTagDebris } from "./answers";

// Regression for the grader occasionally mimicking the prompt's XML-ish wrappers:
// observed live output ended with "...point 2 entirely.</feedback>\n</invoke>\n".
describe("stripTrailingTagDebris", () => {
  it("strips a trailing run of closing tags", () => {
    expect(
      stripTrailingTagDebris("missing point 2 entirely.</feedback>\n</invoke>\n"),
    ).toBe("missing point 2 entirely.");
  });

  it("strips a single trailing closing tag with surrounding whitespace", () => {
    expect(stripTrailingTagDebris("Correct answer.  </feedback>  ")).toBe(
      "Correct answer.",
    );
  });

  it("keeps a legitimate mid-sentence tag mention", () => {
    const text = "In HTML the </div> tag closes a container element.";
    expect(stripTrailingTagDebris(text)).toBe(text);
  });

  it("keeps clean text unchanged", () => {
    expect(stripTrailingTagDebris("A plain sentence.")).toBe("A plain sentence.");
  });

  it("does not strip opening tags", () => {
    const text = "Use <strong> for emphasis";
    expect(stripTrailingTagDebris(text)).toBe(text);
  });
});

describe("normalizeForScan", () => {
  it("strips heading and emphasis markup but keeps the words", () => {
    expect(normalizeForScan("## Caching\nWe use a **write-through** cache.")).toBe(
      "Caching\nWe use a write-through cache.",
    );
  });

  it("levels every bullet marker to one form, so styling cannot signal effort", () => {
    const bulleted = normalizeForScan("* one\n* two");
    const dashed = normalizeForScan("- one\n- two");
    const numbered = normalizeForScan("1. one\n2. two");
    expect(bulleted).toBe(dashed);
    expect(numbered).toBe(dashed);
  });

  it("drops code fence markers and keeps the code", () => {
    expect(normalizeForScan("```sql\nSELECT 1;\n```")).toBe("SELECT 1;");
  });

  it("leaves single asterisks and underscores alone, because code uses them", () => {
    const code = "cost is n * log(n) and the column is created_at";
    expect(normalizeForScan(code)).toBe(code);
  });

  it("makes the same content score-identical whether it was written plain or dressed up", () => {
    const plain = "We shard by tenant id. A hot tenant still pins one node.";
    const dressed = "### Approach\n\n- We shard by **tenant id**.\n- A hot tenant still pins one node.";
    expect(normalizeForScan(dressed)).toContain("We shard by tenant id.");
    expect(normalizeForScan(dressed)).toContain("A hot tenant still pins one node.");
    expect(normalizeForScan(plain)).toBe(plain);
  });

  it("collapses runs of blank lines and trailing spaces", () => {
    expect(normalizeForScan("a   \n\n\n\nb")).toBe("a\n\nb");
  });
});
