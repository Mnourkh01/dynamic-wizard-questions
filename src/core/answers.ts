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
