import { depthTier, levelLabel } from "./ladder";
import type { FinalScore, TopicScore, TopicState } from "./types";

// Normalize arbitrary positive importance values to integers summing to EXACTLY
// 1000, using the largest-remainder (Hamilton) method. Done in code, never by the
// LLM, so the 1000-point split is always exact and reproducible.
export function normalizeImportanceTo1000(raw: number[]): number[] {
  const n = raw.length;
  if (n === 0) return [];

  const safe = raw.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const total = safe.reduce((a, b) => a + b, 0);

  // Degenerate input (all zero) => spread as evenly as possible.
  const exact =
    total > 0 ? safe.map((w) => (w / total) * 1000) : safe.map(() => 1000 / n);

  const floors = exact.map(Math.floor);
  const used = floors.reduce((a, b) => a + b, 0);
  let remainder = 1000 - used;

  // Hand the leftover points to the largest fractional parts first.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floors];
  let k = 0;
  while (remainder > 0 && order.length > 0) {
    result[order[k % order.length].i] += 1;
    remainder -= 1;
    k += 1;
  }
  return result;
}

// Turn final topic states into the 1000-point split. Per-topic points =
// round(importance * theta/10); the headline is the sum of the shown points, so
// the number the user sees always equals its parts.
//
// Only topics that were ACTUALLY assessed (answeredCount > 0) count. A topic never
// reached before the question budget ran out is "not assessed", NOT a failure, so
// it must not drag the score down as if the candidate scored zero on it. The tested
// topics' importance is renormalized to 1000 so the headline reflects measured
// ability across what was covered.
export function computeFinalScore(topics: TopicState[]): FinalScore {
  const tested = topics.filter((t) => t.answeredCount > 0);
  const renorm = normalizeImportanceTo1000(tested.map((t) => t.importance));

  let ti = 0;
  const scored: TopicScore[] = topics.map((t) => {
    if (t.answeredCount === 0) {
      return { name: t.name, importance: 0, theta: t.theta, sigma: t.sigma, points: 0, label: "not assessed" };
    }
    const importance = renorm[ti++];
    return {
      name: t.name,
      importance,
      theta: t.theta,
      sigma: t.sigma,
      points: Math.round(importance * (t.theta / 10)),
      label: levelLabel(t.theta),
    };
  });

  const total = scored.reduce((sum, t) => sum + t.points, 0);

  // Confidence band: each tested topic contributes (importance/10)*sigma of point
  // uncertainty; combine independently (root-sum-square) for the headline band.
  // Untested topics have importance 0 here, so they add nothing.
  const variance = scored.reduce((sum, t) => {
    const sd = (t.importance / 10) * t.sigma;
    return sum + sd * sd;
  }, 0);
  const confidenceInterval = Math.round(Math.sqrt(variance));

  return {
    total,
    confidenceInterval,
    topics: scored,
    // Headline uses the three-tier depth label (Beginner/Intermediate/Advanced);
    // per-topic columns keep the finer 5-level ladder for detail.
    overallLabel: depthTier(total),
  };
}
