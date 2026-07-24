import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyMcqSample } from "@/agents/mcq";
import { costBreakdown, costSoFarUsd, resetCostUsd } from "@/agents/client";

// Bank key audit: the stored correctIndex values in role-banks.json carry most
// of the final score and nothing else ever checks them. This script samples the
// pre-generated banks across ALL roles (seeded, so reruns hit the same items),
// has the model blind-re-answer them without seeing the keys (verifyMcqSample),
// and fails if agreement drops below the floor.
//   npx tsx scripts/verify-role-banks.ts [--sample N]   (default 20)

const AGREEMENT_FLOOR = 0.85;
const DEFAULT_SAMPLE = 20;

interface BankFileMcq {
  topicName: string;
  level: number;
  stem: string;
  options: string[];
  correctIndex: number;
}

interface BankFile {
  version: number;
  roles: { role: string; bank: BankFileMcq[] }[];
}

async function main(): Promise<void> {
  resetCostUsd();
  const argv = process.argv.slice(2);
  const flag = argv.indexOf("--sample");
  const sample = flag !== -1 ? Number(argv[flag + 1]) : DEFAULT_SAMPLE;
  if (!Number.isInteger(sample) || sample < 1) {
    console.error(`--sample must be a positive integer, got: ${argv[flag + 1]}`);
    process.exit(1);
  }

  const path = resolve("src/data/role-banks.json");
  const data = JSON.parse(readFileSync(path, "utf8")) as BankFile;
  const all = data.roles.flatMap((r) =>
    r.bank.map((q) => ({ ...q, role: r.role })),
  );
  console.log(
    `Bank key audit: ${all.length} MCQs across ${data.roles.length} roles, sampling ${Math.min(sample, all.length)}\n`,
  );

  // Context lookup for disagreement printing (stems are unique across the bank
  // in practice; a duplicate stem would just reuse the first match's context).
  const byStem = new Map(all.map((q) => [q.stem, q]));

  const result = await verifyMcqSample(
    all.map((q) => ({ stem: q.stem, options: q.options, correctIndex: q.correctIndex })),
    { sample },
  );

  const rate = result.checked > 0 ? result.agreed / result.checked : 0;
  console.log(
    `agreement: ${result.agreed}/${result.checked} (${(rate * 100).toFixed(1)}%), floor ${AGREEMENT_FLOOR * 100}%`,
  );

  if (result.disagreements.length > 0) {
    console.log(`\ndisagreements (${result.disagreements.length}):`);
    for (const d of result.disagreements) {
      const ctx = byStem.get(d.stem);
      const where = ctx ? `${ctx.role} / ${ctx.topicName} (level ${ctx.level})` : "unknown";
      const expectedText = ctx?.options[d.expected] ?? "?";
      const gotText = d.got >= 0 ? ctx?.options[d.got] ?? "?" : "(no usable answer)";
      console.log(`\n  [${where}]`);
      console.log(`  stem: ${d.stem}`);
      console.log(`  stored key:  [${d.expected}] ${expectedText}`);
      console.log(`  model chose: [${d.got}] ${gotText}`);
    }
  }

  console.log(`\ncost: $${costSoFarUsd().toFixed(4)}`);
  for (const s of costBreakdown()) {
    console.log(
      `  ${s.agent}: ${s.calls} call(s), $${s.costUsd.toFixed(4)}, in ${s.inputTokens} out ${s.outputTokens} tokens`,
    );
  }

  const pass = rate >= AGREEMENT_FLOOR;
  console.log(`\nBANK KEY AUDIT: ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-role-banks failed:", e);
  process.exit(1);
});
