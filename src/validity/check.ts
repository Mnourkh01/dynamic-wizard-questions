import "dotenv/config";
import { runGrader } from "@/agents/grader";
import { classifyAnswer } from "@/core/answers";
import { costSoFarUsd, resetCostUsd } from "@/agents/client";
import { GOLDEN_SET, isInjectionItem, type GoldenBand, type GoldenItem } from "./golden-set";
import { seededSample } from "./sample";

// VALIDITY GATE (mandatory before any UI).
// Proves the score actually measures skill: grade a fixed question against hand
// written answers of KNOWN quality and require the grader to rank them correctly
// (senior > mid > junk) and to be stable on replay. If this is red, the product
// premise (a trusted skill score) is unproven and nothing downstream matters.
//
// Two modes:
//   default          - the original quick gate: one fixed question, six answers,
//                      ranking + band thresholds + replay stability.
//   --golden [--sample N] - grades a seeded, band-stratified sample of the
//                      24-item golden set (src/validity/golden-set.ts) and
//                      asserts band ordering (senior > mid > junior > junk on
//                      the band means) and that prompt-injection answers score
//                      at or below the injection ceiling.

const SEED = {
  question:
    "Explain what a database index is, why it makes read queries faster, and describe one concrete downside of adding many indexes to a write-heavy table.",
  rubricPoints: [
    "An index is a separate auxiliary data structure (for example a B-tree) that maps column values to the matching rows.",
    "It speeds up reads by avoiding a full table scan, turning a lookup into roughly logarithmic instead of linear work.",
    "Indexes cost extra storage and must be kept in sync with the table.",
    "Indexes slow down writes (INSERT/UPDATE/DELETE) because every index must also be updated, which hurts a write-heavy table.",
  ],
  gold:
    "An index is a separate sorted structure (commonly a B-tree) keyed on one or more columns, pointing at the rows that hold each value. Reads get faster because the engine can descend the tree in O(log n) instead of scanning every row. The cost: each index takes extra disk and, more importantly, every insert, update, or delete must also update every affected index, so a write-heavy table gets slower and more write-amplified as you add indexes.",
};

type Tier = "senior" | "mid" | "junk";

const ANSWERS: { label: string; tier: Tier; text: string }[] = [
  {
    label: "senior-1",
    tier: "senior",
    text: "An index is a separate on-disk data structure, usually a B-tree (or B+ tree), keyed on one or more columns and holding pointers to the actual rows. Reads speed up because instead of a full table scan (O(n)) the engine walks the tree in O(log n) to find matching rows, and range scans stay ordered. The trade-off on a write-heavy table is write amplification: every INSERT, UPDATE, or DELETE that touches an indexed column must also update each relevant index, plus the extra storage and page splits. So adding many indexes to a table that is written to constantly can noticeably slow those writes.",
  },
  {
    label: "senior-2",
    tier: "senior",
    text: "Think of an index as a maintained, sorted lookup structure (typically a B-tree) that maps values in a column to the rows containing them. Without it the database must scan the whole table to find rows; with it, lookups become logarithmic and equality/range predicates are answered by descending the tree. The downside: indexes are not free. They consume additional storage, and crucially they must be kept consistent on every write, so on a write-heavy table each additional index adds overhead to inserts, updates, and deletes, degrading write throughput.",
  },
  {
    label: "mid-1",
    tier: "mid",
    text: "An index makes queries faster by letting the database find the rows it needs without scanning the entire table. It works like a sorted lookup so the database can jump closer to the data. The main downside I know is that indexes take up more disk space, so you do not want to index everything.",
  },
  {
    label: "mid-2",
    tier: "mid",
    text: "Indexes speed up SELECT queries a lot because the database can go straight to the matching rows instead of reading every row. You usually put them on columns you filter or join on. They can also slow inserts down a little because there is extra bookkeeping, so you only add the ones you need.",
  },
  {
    label: "junk-1",
    tier: "junk",
    text: "A database index is basically the front page of the database, like a table of contents in a book, that lists all the tables and columns so the database looks organized and is easier for developers to read. It makes everything faster automatically and there is no real downside to adding as many as you want.",
  },
  {
    label: "junk-2",
    tier: "junk",
    text: "idk",
  },
];

async function gradeScore(text: string): Promise<number> {
  // Mirror the orchestrator: degenerate answers score 0 with no grader call.
  if (classifyAnswer(text).degenerate) return 0;
  const res = await runGrader({
    question: SEED.question,
    rubricPoints: SEED.rubricPoints,
    gold: SEED.gold,
    answer: text,
    language: "en",
  });
  return res.data.score;
}

function stats(nums: number[]) {
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return { mean, sd: Math.sqrt(variance), min: Math.min(...nums), max: Math.max(...nums) };
}

async function quickMain(): Promise<void> {
  resetCostUsd();
  const replays = Number(process.env.VARIANCE_REPLAYS ?? 6);
  console.log("VALIDITY GATE - grading hand-written answers of known quality\n");

  const scored: { label: string; tier: Tier; score: number }[] = [];
  for (const a of ANSWERS) {
    const score = await gradeScore(a.text);
    scored.push({ label: a.label, tier: a.tier, score });
    console.log(`  ${a.label.padEnd(9)} [${a.tier.padEnd(6)}]  score ${score}`);
  }

  const band = (t: Tier) => scored.filter((s) => s.tier === t).map((s) => s.score);
  const senior = band("senior");
  const mid = band("mid");
  const junk = band("junk");

  const minSenior = Math.min(...senior);
  const maxMid = Math.max(...mid);
  const maxJunk = Math.max(...junk);

  // Ranking must hold with a clear margin between tiers.
  const rankingOk = minSenior > maxMid && maxMid > maxJunk;
  const bandsOk = minSenior >= 78 && maxMid <= 74 && maxJunk <= 35;

  console.log(
    `\n  bands: senior>=${minSenior}  mid<=${maxMid}  junk<=${maxJunk}`,
  );
  console.log(`  ranking senior>mid>junk: ${rankingOk ? "OK" : "FAIL"}`);
  console.log(`  band thresholds (senior>=78, mid<=74, junk<=35): ${bandsOk ? "OK" : "FAIL"}`);

  // Grader stability: replay one mid answer and measure the spread.
  console.log(`\n  variance: replaying mid-1 x${replays} ...`);
  const midText = ANSWERS.find((a) => a.label === "mid-1")!.text;
  const runs: number[] = [];
  for (let i = 0; i < replays; i++) runs.push(await gradeScore(midText));
  const v = stats(runs);
  console.log(`  scores: [${runs.join(", ")}]`);
  console.log(`  mean ${v.mean.toFixed(1)}  sd ${v.sd.toFixed(1)}  spread ${v.min}-${v.max}`);
  const stableOk = v.sd <= 12;
  console.log(`  stability (sd <= 12): ${stableOk ? "OK" : "FAIL"}`);

  const pass = rankingOk && bandsOk && stableOk;
  console.log(`\n  cost: $${costSoFarUsd().toFixed(4)}`);
  console.log(`\n  VALIDITY GATE: ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

// --- Golden mode --------------------------------------------------------------

// Injection answers must be crushed, not merely scored low.
const INJECTION_SCORE_CEILING = 10;

// Ranked strongest first; the ordering assertion walks this list.
const BAND_ORDER: GoldenBand[] = ["senior", "mid", "junior", "junk"];

// Grade one golden item exactly the way the orchestrator grades a live answer:
// degenerate answers are zeroed in code with no grader call.
async function gradeGoldenItem(item: GoldenItem): Promise<number> {
  if (classifyAnswer(item.answer).degenerate) return 0;
  const res = await runGrader({
    question: item.question,
    rubricPoints: item.rubricPoints,
    gold: item.gold,
    answer: item.answer,
    language: item.language,
  });
  return res.data.score;
}

// Band-stratified seeded sample: an even quota per band (remainder to the
// stronger bands first) so every band is represented and the ordering assertion
// is meaningful even at small N. The junk quota is nudged to always include at
// least one prompt-injection item, so the injection ceiling is actually tested.
function stratifiedGoldenSample(sampleSize: number): GoldenItem[] {
  const base = Math.floor(sampleSize / BAND_ORDER.length);
  const remainder = sampleSize % BAND_ORDER.length;
  const picked: GoldenItem[] = [];
  BAND_ORDER.forEach((band, i) => {
    const bandItems = GOLDEN_SET.filter((g) => g.expectedBand === band);
    const quota = Math.min(bandItems.length, base + (i < remainder ? 1 : 0));
    let bandPick = seededSample(bandItems, quota, `golden:${band}`);
    if (band === "junk" && quota > 0 && !bandPick.some(isInjectionItem)) {
      const injections = bandItems.filter(isInjectionItem);
      if (injections.length > 0) {
        bandPick = [
          ...bandPick.slice(0, -1),
          ...seededSample(injections, 1, "golden:injection"),
        ];
      }
    }
    picked.push(...bandPick);
  });
  return picked;
}

async function goldenMain(sampleSize: number): Promise<void> {
  resetCostUsd();
  if (!Number.isInteger(sampleSize) || sampleSize < BAND_ORDER.length) {
    console.error(`--golden needs --sample of at least ${BAND_ORDER.length} (one per band); got ${sampleSize}`);
    process.exit(1);
  }
  const sampled = stratifiedGoldenSample(sampleSize);
  console.log(
    `VALIDITY GATE (golden mode) - grading ${sampled.length} of ${GOLDEN_SET.length} golden items\n`,
  );

  const scored: { item: GoldenItem; score: number }[] = [];
  for (const item of sampled) {
    const score = await gradeGoldenItem(item);
    scored.push({ item, score });
    console.log(
      `  [${item.expectedBand.padEnd(6)}] [${item.language}] score ${String(score).padStart(3)}  ${item.note}`,
    );
  }

  console.log("\n  per-band results:");
  const bandStats = new Map<GoldenBand, { mean: number; sd: number; n: number }>();
  for (const band of BAND_ORDER) {
    const scores = scored.filter((s) => s.item.expectedBand === band).map((s) => s.score);
    if (scores.length === 0) {
      console.log(`    ${band.padEnd(6)}  (no items sampled)`);
      continue;
    }
    const v = stats(scores);
    bandStats.set(band, { mean: v.mean, sd: v.sd, n: scores.length });
    console.log(
      `    ${band.padEnd(6)}  n=${scores.length}  mean ${v.mean.toFixed(1)}  sd ${v.sd.toFixed(1)}  spread ${v.min}-${v.max}`,
    );
  }

  // Assertion 1: every band represented (stratified sampling should guarantee it).
  const allBandsPresent = BAND_ORDER.every((b) => bandStats.has(b));

  // Assertion 2: strict band ordering on the means.
  let orderingOk = allBandsPresent;
  if (allBandsPresent) {
    for (let i = 0; i < BAND_ORDER.length - 1; i++) {
      const hi = bandStats.get(BAND_ORDER[i])!.mean;
      const lo = bandStats.get(BAND_ORDER[i + 1])!.mean;
      if (!(hi > lo)) {
        orderingOk = false;
        console.log(
          `    ORDERING VIOLATION: ${BAND_ORDER[i]} mean ${hi.toFixed(1)} is not above ${BAND_ORDER[i + 1]} mean ${lo.toFixed(1)}`,
        );
      }
    }
  }
  console.log(`\n  band ordering senior > mid > junior > junk: ${orderingOk ? "OK" : "FAIL"}`);

  // Assertion 3: sampled injection answers stay at or below the ceiling.
  const injectionResults = scored.filter((s) => isInjectionItem(s.item));
  const injectionOk = injectionResults.every((s) => s.score <= INJECTION_SCORE_CEILING);
  for (const s of injectionResults) {
    console.log(
      `  injection item score ${s.score} (ceiling ${INJECTION_SCORE_CEILING}): ${
        s.score <= INJECTION_SCORE_CEILING ? "OK" : "FAIL"
      }  ${s.item.note}`,
    );
  }
  if (injectionResults.length === 0) {
    console.log("  note: no injection items landed in this sample");
  }

  const pass = orderingOk && injectionOk;
  console.log(`\n  cost: $${costSoFarUsd().toFixed(4)}`);
  console.log(`\n  VALIDITY GATE (golden): ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

// --- CLI ------------------------------------------------------------------------

const argv = process.argv.slice(2);
const goldenMode = argv.includes("--golden");
const sampleFlag = argv.indexOf("--sample");
const sampleSize = sampleFlag !== -1 ? Number(argv[sampleFlag + 1]) : GOLDEN_SET.length;

(goldenMode ? goldenMain(sampleSize) : quickMain()).catch((err) => {
  console.error("Validity check failed to run:", err);
  process.exit(1);
});
