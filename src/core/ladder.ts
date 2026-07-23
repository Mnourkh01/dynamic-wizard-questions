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

// A short description of what a question at this level should demand, handed to
// the Question agent so difficulty is grounded, not vibes.
export function difficultyBrief(level: number): string {
  const l = clamp(level, THETA_MIN, THETA_MAX);
  if (l <= 2)
    return "a broad, open discovery question that asks the candidate to explain a core concept of the topic and how it works. It must be answerable simply by a beginner AND allow an expert to reveal real depth (internals, trade-offs). Not a narrow scenario, not a trick, not multi-part.";
  if (l <= 4) return "a straightforward applied question expected of a junior practitioner";
  if (l <= 6) return "a practical scenario question requiring solid mid-level understanding";
  if (l <= 8) return "a deep design or trade-off question expected of a senior engineer";
  return "an expert question probing edge cases, failure modes, or architecture at scale";
}

// The three-tier depth label for the headline score, matching the depth matrix:
// surface (Beginner), practical (Intermediate), deep/architectural (Advanced).
export function depthTier(scoreOutOf1000: number): string {
  const pct = (scoreOutOf1000 / 1000) * 100;
  if (pct <= 40) return "Beginner";
  if (pct <= 75) return "Intermediate";
  return "Advanced";
}
