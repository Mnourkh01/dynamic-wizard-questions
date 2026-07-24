import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { costBreakdown, costSoFarUsd } from "@/agents/client";
import { runBlueprint } from "@/agents/blueprint";
import { runBankBuilder } from "@/agents/mcq";
import { isValidMcq } from "@/core/mcq";
import type { Language } from "@/core/types";
import type { RoleBank } from "@/data/role-banks";
import { ROLE_PRESETS } from "@/lib/i18n";

// One-time generator: pre-builds topics + MCQ bank for every fixed role chip so
// the app starts INSTANTLY for those roles (no AI at Begin). One language per
// run, and INCREMENTAL: every entry already in role-banks.json is preserved
// exactly as-is, only missing (role, language) pairs are generated, and the
// file is saved after every finished role so a failed run never loses paid
// work. Calls run sequentially (subscription rate limits). Re-run with a
// language to fill that language's gaps; re-running a fully seeded language is
// a no-op with zero AI calls.
//   npm run seed:roles                                (English banks)
//   npx tsx scripts/gen-role-banks.ts --language ar   (Arabic banks)

interface BankFile {
  version: number;
  generatedRoles: number;
  roles: RoleBank[];
}

const norm = (s: string) => s.trim().toLowerCase();

function parseLanguage(argv: string[]): Language {
  const flag = argv.indexOf("--language");
  if (flag === -1) return "en";
  const value = argv[flag + 1];
  if (value !== "en" && value !== "ar") {
    console.error(`--language must be "en" or "ar", got: ${value ?? "(missing)"}`);
    process.exit(1);
  }
  return value;
}

function loadExisting(path: string): RoleBank[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<BankFile>;
  return Array.isArray(parsed.roles) ? parsed.roles : [];
}

// Existing entries round-trip byte-for-byte: they were written by this same
// JSON.stringify(..., null, 2) and JSON.parse preserves key order.
function save(path: string, roles: RoleBank[]): void {
  const out: BankFile = { version: 1, generatedRoles: roles.length, roles };
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
}

// Build one (role, language) entry: blueprint (topic planner) then the full MCQ
// bank. Returns null when the planner marks the role not assessable.
async function generateRole(role: string, language: Language): Promise<RoleBank | null> {
  process.stdout.write("blueprint... ");
  const bp = await runBlueprint({ role, language });
  if (!bp.data.assessable || bp.data.topics.length === 0) return null;
  const topics = bp.data.topics.map((t) => ({
    name: t.name,
    importance: t.importance,
    startLevel: t.startLevel,
  }));

  process.stdout.write(`${topics.length} topics, bank... `);
  const bank = await runBankBuilder({ role, topics: topics.map((t) => t.name), language });
  const flat = bank.data.topics.flatMap((bt) => {
    const match = topics.find((t) => norm(t.name) === norm(bt.name));
    if (!match) return [];
    return bt.questions.flatMap((q) =>
      isValidMcq(q.options, q.correctIndex)
        ? [
            {
              topicName: match.name,
              level: q.level,
              stem: q.stem,
              options: q.options,
              correctIndex: q.correctIndex,
            },
          ]
        : [],
    );
  });

  return { role, language, topics, bank: flat };
}

async function main(): Promise<void> {
  const language = parseLanguage(process.argv.slice(2));
  const path = resolve("src/data/role-banks.json");
  const roles = loadExisting(path);

  const added: { role: string; mcqs: number; costUsd: number }[] = [];
  const skipped: string[] = [];
  const notAssessable: string[] = [];
  const failed: { role: string; error: string }[] = [];

  for (const role of ROLE_PRESETS) {
    if (roles.some((r) => norm(r.role) === norm(role) && r.language === language)) {
      console.log(`${role} [${language}]: already seeded, skipped`);
      skipped.push(role);
      continue;
    }

    const costBefore = costSoFarUsd();
    let entry: RoleBank | null = null;
    let done = false;
    let lastError = "";
    // One retry per role, then skip: a single bad spawn must not kill the run,
    // but a role that fails twice is reported and left for a re-run.
    for (let attempt = 1; attempt <= 2 && !done; attempt++) {
      try {
        process.stdout.write(`\n${role} [${language}]${attempt > 1 ? " (retry)" : ""}: `);
        entry = await generateRole(role, language);
        done = true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.log(`FAILED: ${lastError}`);
      }
    }
    const costUsd = costSoFarUsd() - costBefore;

    if (!done) {
      failed.push({ role, error: lastError });
      continue;
    }
    if (!entry) {
      console.log("not assessable, skipped");
      notAssessable.push(role);
      continue;
    }

    roles.push(entry);
    save(path, roles); // save per role: a later failure never loses this one
    added.push({ role, mcqs: entry.bank.length, costUsd });
    console.log(`${entry.bank.length} MCQs, cost $${costUsd.toFixed(4)}`);
  }

  const totalMcqs = roles.reduce((n, r) => n + r.bank.length, 0);
  console.log(`\n${path}: ${roles.length} entries total, ${totalMcqs} MCQs total`);
  console.log(`\nThis run [${language}]:`);
  for (const a of added) {
    console.log(`  added   ${a.role}: ${a.mcqs} MCQs, $${a.costUsd.toFixed(4)}`);
  }
  for (const s of skipped) console.log(`  skipped ${s}: already seeded`);
  for (const n of notAssessable) console.log(`  skipped ${n}: not assessable`);
  for (const f of failed) console.log(`  FAILED  ${f.role}: ${f.error}`);
  console.log(`\ntotal cost this run: $${costSoFarUsd().toFixed(4)}`);
  for (const s of costBreakdown()) {
    console.log(
      `  ${s.agent}: ${s.calls} call(s), $${s.costUsd.toFixed(4)}, in ${s.inputTokens} out ${s.outputTokens} tokens`,
    );
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("gen-role-banks failed:", e);
  process.exit(1);
});
