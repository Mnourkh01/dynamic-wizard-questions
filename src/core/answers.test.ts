import { describe, expect, it } from "vitest";
import { stripTrailingTagDebris } from "./answers";

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
