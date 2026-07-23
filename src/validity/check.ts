import "dotenv/config";
import { runGrader } from "@/agents/grader";
import { classifyAnswer } from "@/core/answers";
import { costSoFarUsd, resetCostUsd } from "@/agents/client";

// VALIDITY GATE (mandatory before any UI).
// Proves the score actually measures skill: grade a fixed question against hand
// written answers of KNOWN quality and require the grader to rank them correctly
// (senior > mid > junk) and to be stable on replay. If this is red, the product
// premise (a trusted skill score) is unproven and nothing downstream matters.

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

async function main(): Promise<void> {
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

main().catch((err) => {
  console.error("Validity check failed to run:", err);
  process.exit(1);
});
