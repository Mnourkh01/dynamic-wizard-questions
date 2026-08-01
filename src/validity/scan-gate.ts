import "dotenv/config";
import { scanAnswer } from "@/agents/scanner";
import { costBreakdown, costSoFarUsd, resetCostUsd } from "@/agents/client";
import { BAND_MAX, BAND_MIN, bandName } from "@/core/signals";
import { shutdownObservability } from "@/observability/langfuse";
import { GOLDEN_ANSWERS, type GoldenItem, rankedPairs } from "./golden-answers";

// The release gate for text mode. Runs the scanner over the hand-labelled golden
// set and reports whether it is good enough to replace the MCQ bank.
//
//   npm run validity:scan                 all items
//   npm run validity:scan -- --only idx   only items whose id starts with "idx"
//   npm run validity:scan -- --repeat 3   run each item N times to measure stability
//
// Targets (docs/PLAN-v2.md section 9):
//   ordering on ranked pairs   100 percent   BLOCKING
//   adjacent-band accuracy     >= 92 percent
//   exact-band accuracy        >= 75 percent
//   QWK                        >= 0.70

// Two items at a time by default. Each item is already three concurrent CLI
// children, so that is six live `claude` processes at peak, which is as far as
// one local machine should be pushed. Drop it to 1 when other work is competing
// for the machine: --concurrency 1.
const DEFAULT_ITEM_CONCURRENCY = 2;

interface Outcome {
  item: GoldenItem;
  bands: number[];
  band: number;
  promotions: string[];
  caps: string[];
  matched: number;
  error?: string;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// The band a repeated item settles on: the most frequent read, ties going to the
// lower band so instability never flatters a candidate.
function consensus(bands: number[]): number {
  const counts = new Map<number, number>();
  for (const b of bands) counts.set(b, (counts.get(b) ?? 0) + 1);
  let best = bands[0];
  let bestCount = 0;
  for (const [band, count] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (count > bestCount) {
      best = band;
      bestCount = count;
    }
  }
  return best;
}

async function runItem(item: GoldenItem, repeats: number): Promise<Outcome> {
  const bands: number[] = [];
  let promotions: string[] = [];
  let caps: string[] = [];
  let matched = 0;
  try {
    for (let i = 0; i < repeats; i++) {
      const res = await scanAnswer({
        question: item.question,
        rubricPoints: item.rubricPoints,
        gold: item.gold,
        answer: item.answer,
        affords: item.affords,
        language: item.language,
        degenerate: false,
      });
      bands.push(res.read.band);
      promotions = res.read.promotions;
      caps = res.read.caps;
      matched = res.evidence.matchedRubricPoints;
    }
  } catch (err) {
    return {
      item,
      bands,
      band: 0,
      promotions,
      caps,
      matched,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { item, bands, band: consensus(bands), promotions, caps, matched };
}

// Quadratic weighted kappa over the band scale. Chance-corrected, and it
// penalises a two-band miss four times as hard as a one-band miss, which is the
// right shape for an ordered scale.
function quadraticWeightedKappa(pairs: Array<[number, number]>): number {
  const n = BAND_MAX - BAND_MIN + 1;
  const idx = (b: number) => Math.min(n - 1, Math.max(0, b - BAND_MIN));
  const observed = Array.from({ length: n }, () => new Array(n).fill(0));
  const expectedRow = new Array(n).fill(0);
  const expectedCol = new Array(n).fill(0);

  for (const [expected, actual] of pairs) {
    observed[idx(expected)][idx(actual)] += 1;
    expectedRow[idx(expected)] += 1;
    expectedCol[idx(actual)] += 1;
  }

  const total = pairs.length;
  if (total === 0) return 0;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const w = ((i - j) * (i - j)) / ((n - 1) * (n - 1));
      const e = (expectedRow[i] * expectedCol[j]) / total;
      num += w * observed[i][j];
      den += w * e;
    }
  }
  return den === 0 ? 1 : 1 - num / den;
}

async function main(): Promise<void> {
  resetCostUsd();
  const only = arg("--only");
  const repeats = Number(arg("--repeat") ?? 1);
  const concurrency = Math.max(1, Number(arg("--concurrency") ?? DEFAULT_ITEM_CONCURRENCY));
  const items = only ? GOLDEN_ANSWERS.filter((i) => i.id.startsWith(only)) : GOLDEN_ANSWERS;

  if (items.length === 0) {
    console.error(`No golden items match "${only}".`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nScanner gate: ${items.length} items, ${repeats} run(s) each, ${concurrency} at a time.\n`,
  );

  const started = Date.now();
  const outcomes: Outcome[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        outcomes[i] = await runItem(items[i], repeats);
        const o = outcomes[i];
        const mark = o.error ? "ERR" : o.band === o.item.expectedBand ? " ok" : "MISS";
        const spread = o.bands.length > 1 ? ` [${o.bands.join(",")}]` : "";
        console.log(
          `${mark}  ${o.item.id.padEnd(26)} expected ${o.item.expectedBand}  got ${o.band}${spread}${
            o.error ? `  ${o.error.slice(0, 120)}` : ""
          }`,
        );
      }
    }),
  );

  const ok = outcomes.filter((o) => !o.error);
  const failed = outcomes.filter((o) => o.error);

  console.log("\n──────── per item ────────");
  for (const o of ok) {
    const flag = o.band === o.item.expectedBand ? " " : o.band > o.item.expectedBand ? "+" : "-";
    console.log(
      `${flag} ${o.item.id.padEnd(26)} ${String(o.item.expectedBand)} -> ${String(o.band)} ${bandName(
        o.band,
      ).padEnd(11)} rubric ${o.matched}/${o.item.rubricPoints.length}`,
    );
    if (o.promotions.length > 0) console.log(`    up:   ${o.promotions.join(" | ")}`);
    if (o.caps.length > 0) console.log(`    cap:  ${o.caps.join(" | ")}`);
    if (o.band !== o.item.expectedBand) console.log(`    why:  ${o.item.note}`);
  }

  const exact = ok.filter((o) => o.band === o.item.expectedBand).length;
  const adjacent = ok.filter((o) => Math.abs(o.band - o.item.expectedBand) <= 1).length;
  const qwk = quadraticWeightedKappa(ok.map((o) => [o.item.expectedBand, o.band]));

  // Ordering: for every labelled pair two or more bands apart, the scanner must
  // not place the stronger answer at or below the weaker one. This is the gate
  // a single labeller can hold honestly, so it is the blocking criterion.
  const byId = new Map(ok.map((o) => [o.item.id, o]));
  const pairs = rankedPairs().filter((p) => byId.has(p.stronger.id) && byId.has(p.weaker.id));
  const violations = pairs.filter(
    (p) => byId.get(p.stronger.id)!.band <= byId.get(p.weaker.id)!.band,
  );

  const flips = ok.filter((o) => new Set(o.bands).size > 1);

  const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));
  console.log("\n──────── gate ────────");
  const line = (label: string, value: string, pass: boolean, target: string) =>
    console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(26)} ${value.padEnd(12)} target ${target}`);

  line(
    "ordering (ranked pairs)",
    `${pairs.length - violations.length}/${pairs.length}`,
    violations.length === 0,
    "100%  BLOCKING",
  );
  line("adjacent-band accuracy", `${pct(adjacent, ok.length)}%`, pct(adjacent, ok.length) >= 92, ">= 92%");
  line("exact-band accuracy", `${pct(exact, ok.length)}%`, pct(exact, ok.length) >= 75, ">= 75%");
  line("QWK", qwk.toFixed(3), qwk >= 0.7, ">= 0.70");
  if (repeats > 1) {
    line("stable across repeats", `${ok.length - flips.length}/${ok.length}`, flips.length === 0, "no flips");
  }

  for (const v of violations) {
    console.log(
      `  ordering violation: ${v.stronger.id} (${byId.get(v.stronger.id)!.band}) not above ${v.weaker.id} (${byId.get(v.weaker.id)!.band})`,
    );
  }
  if (failed.length > 0) {
    console.log(`\n${failed.length} item(s) errored and are excluded from every number above:`);
    for (const f of failed) console.log(`  ${f.item.id}: ${f.error}`);
  }

  const rows = costBreakdown();
  if (rows.length > 0) {
    console.log("\n──────── spend ────────");
    for (const r of rows) console.log(`  ${r.agent.padEnd(26)} ${r.calls} calls  $${r.costUsd.toFixed(4)}`);
  }
  console.log(
    `\nTotal $${costSoFarUsd().toFixed(4)} · ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );

  const blocking = violations.length === 0 && failed.length === 0;
  if (!blocking) process.exitCode = 1;
  await shutdownObservability();
}

main().catch(async (err) => {
  console.error("Scanner gate failed:", err);
  await shutdownObservability();
  process.exit(1);
});
