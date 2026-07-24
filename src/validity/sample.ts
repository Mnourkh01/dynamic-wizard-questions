import { seedFromKey } from "@/core/shuffle";

// Deterministic K-of-N sampling for the validity tooling: order items by an
// FNV-1a hash of seedKey + index and take the first K. Same items + same key
// always give the same sample, so a validity run is reproducible while still
// spreading picks across the whole set. Pure and dependency-light on purpose.
export function seededSample<T>(items: T[], count: number, seedKey: string): T[] {
  const order = items
    .map((_, i) => i)
    .sort((a, b) => seedFromKey(`${seedKey}:${a}`) - seedFromKey(`${seedKey}:${b}`));
  return order.slice(0, Math.max(0, Math.min(count, items.length))).map((i) => items[i]);
}
