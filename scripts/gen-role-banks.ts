import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runBlueprint } from "@/agents/blueprint";
import { runBankBuilder } from "@/agents/mcq";
import { isValidMcq } from "@/core/mcq";
import type { RoleBank } from "@/data/role-banks";
import { ROLE_PRESETS } from "@/lib/i18n";

// One-time generator: pre-builds topics + MCQ bank for every fixed role chip so
// the app starts INSTANTLY for those roles (no AI at Begin). Re-run when the role
// list or the bank prompts change.
//   npm run seed:roles
async function main(): Promise<void> {
  const language = "en";
  const roles: RoleBank[] = [];
  const norm = (s: string) => s.trim().toLowerCase();

  for (const role of ROLE_PRESETS) {
    process.stdout.write(`\n${role}: blueprint... `);
    const bp = await runBlueprint({ role, language });
    if (!bp.data.assessable || bp.data.topics.length === 0) {
      console.log("not assessable, skipped");
      continue;
    }
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

    roles.push({ role, language, topics, bank: flat });
    console.log(`${flat.length} MCQs`);
  }

  const out = { version: 1, generatedRoles: roles.length, roles };
  const path = resolve("src/data/role-banks.json");
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  const totalMcqs = roles.reduce((n, r) => n + r.bank.length, 0);
  console.log(`\nWrote ${path}: ${roles.length} roles, ${totalMcqs} MCQs total`);
}

main().catch((e) => {
  console.error("gen-role-banks failed:", e);
  process.exit(1);
});
