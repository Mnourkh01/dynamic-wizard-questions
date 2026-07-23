import { THETA_MAX, THETA_MIN } from "./constants";

// The difficulty ladder maps the continuous ability estimate (1..10) to a level
// integer, a human label, and a description the Question agent uses to aim a
// question at the right band.

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampLevel(theta: number): number {
  return clamp(Math.round(theta), THETA_MIN, THETA_MAX);
}

export function levelLabel(theta: number): string {
  const level = clampLevel(theta);
  if (level <= 2) return "novice";
  if (level <= 4) return "junior";
  if (level <= 6) return "mid";
  if (level <= 8) return "senior";
  return "staff/expert";
}

// Present difficulty as an organized course level (101..110), so a question at a
// given level reads as a rung on a ladder rather than a vague "hard" label.
export function courseLevel(level: number): number {
  return 100 + clamp(level, THETA_MIN, THETA_MAX);
}

// A short description of what a question at this level should demand, handed to
// the Question agent so difficulty is grounded, not vibes. Framed as a course
// ladder (101 -> 102 -> 103 ...) so each level BUILDS on the one below instead of
// repeating it.
export function difficultyBrief(level: number): string {
  const l = clamp(level, THETA_MIN, THETA_MAX);
  const c = courseLevel(l);
  if (l <= 2)
    return `a level ${c} (101-style) intro question: simple and foundational, asking the candidate to explain a core concept of the topic in plain terms. Answerable by a beginner, and phrased so a stronger answer can still show more depth. Not a scenario, not a trick, not multi-part.`;
  if (l <= 4)
    return `a level ${c} question: a straightforward applied question one step up from the basics, expected of a junior practitioner. Build on the 101 fundamentals, do not repeat them.`;
  if (l <= 6)
    return `a level ${c} question: a practical scenario requiring solid mid-level understanding, a clear step above the junior level.`;
  if (l <= 8)
    return `a level ${c} question: a deep design or trade-off question expected of a senior engineer, well above mid-level.`;
  return `a level ${c} question: an expert-level problem probing edge cases, failure modes, or architecture at scale.`;
}

// The three-tier depth label for the headline score, matching the depth matrix:
// surface (Beginner), practical (Intermediate), deep/architectural (Advanced).
export function depthTier(scoreOutOf1000: number): string {
  const pct = (scoreOutOf1000 / 1000) * 100;
  if (pct <= 40) return "Beginner";
  if (pct <= 75) return "Intermediate";
  return "Advanced";
}
