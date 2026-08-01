// Code-side answer classification. Degenerate answers (empty, gibberish,
// too-short, explicit non-answers) are detected here and short-circuited to a
// zero grade WITHOUT spending an Opus grading call. Deterministic and testable.

const NON_ANSWER_PATTERNS = [
  /^i\s*(really\s*)?(don'?t|do not)\s*know\b/i,
  /^no\s*idea\b/i,
  /^idk\b/i,
  /^n\/?a\b/i,
  /^skip\b/i,
  /^\?+$/,
];

const MIN_MEANINGFUL_CHARS = 15;
const MIN_MEANINGFUL_WORDS = 3;

export interface AnswerClassification {
  degenerate: boolean;
  reason?: string;
}

// Agent prompts wrap data in XML-ish tags (<answer>...</answer>), and the model
// occasionally mimics them, leaving closing-tag debris like "</feedback>\n</invoke>"
// glued to the END of a JSON string value. Strip only a trailing run of closing
// tags, so a legitimate mid-sentence mention of a tag is never touched.
const TRAILING_TAG_DEBRIS = /(\s*<\/[a-zA-Z][\w.-]*>)+\s*$/;

export function stripTrailingTagDebris(text: string): string {
  return text.replace(TRAILING_TAG_DEBRIS, "").trimEnd();
}

// Flatten an answer's formatting before it is scanned.
//
// Markdown styling is the single largest measured bias in LLM grading: the same
// content in markdown versus plain prose moves a judge's verdict by roughly 20
// times as much as answer-order bias does. A candidate who happens to write in
// bullets and bold must not out-score one who writes the same thing in a
// paragraph, so the styling is removed and only the content is judged.
//
// Deliberately conservative. Enumeration survives (as a plain "- "), because
// whether someone enumerated is a real structural signal; only the choice of
// marker is noise. Code fence markers go, the code inside stays. Single
// asterisks and underscores are left alone: they appear inside real code far
// more often than as emphasis, and mangling code would cost more than the bias.
//
// This is also the canonical text quotes are verified against, so the scanner
// and the verifier must both see exactly this string, never the raw one.
export function normalizeForScan(text: string): string {
  return text
    .replace(/^\s*```[^\n]*$/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "- ")
    .replace(/^[ \t]+| +$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function classifyAnswer(text: string): AnswerClassification {
  const trimmed = text.trim();

  if (trimmed.length === 0) return { degenerate: true, reason: "empty" };

  if (NON_ANSWER_PATTERNS.some((re) => re.test(trimmed))) {
    return { degenerate: true, reason: "explicit-non-answer" };
  }

  if (trimmed.length < MIN_MEANINGFUL_CHARS) {
    return { degenerate: true, reason: "too-short" };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < MIN_MEANINGFUL_WORDS) {
    return { degenerate: true, reason: "too-few-words" };
  }

  // No letters at all (pure punctuation/numbers) => not a real answer.
  if (!/[a-z؀-ۿ]/i.test(trimmed)) {
    return { degenerate: true, reason: "no-letters" };
  }

  return { degenerate: false };
}
