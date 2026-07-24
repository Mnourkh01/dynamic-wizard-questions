// Deterministic MCQ option shuffle. The bank generator (an LLM) puts the correct
// option first ~76% of the time, so serving options verbatim makes the exam
// gameable (always picking A scored 916/1000 in QA). Shuffling here, in pure
// code keyed by session + question, keeps "code owns every number": same key
// always yields the same order (testable, reproducible), different sessions see
// different orders for the same bank question.

// FNV-1a 32-bit hash: turns the shuffle key into a PRNG seed.
export function seedFromKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: tiny deterministic PRNG, plenty for shuffling 2-5 options.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ShuffledMcq {
  options: string[];
  correctIndex: number;
}

// Fisher-Yates over an index permutation, then remap correctIndex to wherever
// the original correct option landed.
export function shuffleMcqOptions(
  key: string,
  options: string[],
  correctIndex: number,
): ShuffledMcq {
  const order = options.map((_, i) => i);
  const rand = mulberry32(seedFromKey(key));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    options: order.map((i) => options[i]),
    correctIndex: order.indexOf(correctIndex),
  };
}
