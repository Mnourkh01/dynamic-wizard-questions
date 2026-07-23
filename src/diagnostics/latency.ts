import "dotenv/config";
import { runGrader } from "@/agents/grader";
import { runQuestion } from "@/agents/question";
import { costSoFarUsd, resetCostUsd } from "@/agents/client";

// Isolated latency probe: a FRESH process making just two calls (one Sonnet
// question, one Opus grade). If these are fast, the ~26-min full session was
// subscription throttling from back-to-back volume, not per-call cost.

async function main(): Promise<void> {
  resetCostUsd();

  const t0 = Date.now();
  const q = await runQuestion({
    topic: "REST API design",
    difficulty: 6,
    difficultyBrief: "a practical scenario question requiring solid mid-level understanding",
    discovery: false,
    alreadyAsked: [],
    language: "en",
  });
  const tQuestion = Date.now() - t0;
  console.log(`question (sonnet): ${(tQuestion / 1000).toFixed(1)}s`);

  const t1 = Date.now();
  await runGrader({
    question: q.data.text,
    rubricPoints: q.data.rubricPoints,
    gold: q.data.gold,
    answer:
      "You should use proper HTTP verbs: GET to read, POST to create, PUT/PATCH to update, DELETE to remove. Return 200 for a successful read, 201 for a create, and 404 when the resource does not exist. Keep URLs noun-based like /tasks/123 rather than verbs in the path.",
    language: "en",
  });
  const tGrade = Date.now() - t1;
  console.log(`grade (opus):    ${(tGrade / 1000).toFixed(1)}s`);

  console.log(`total: ${((Date.now() - t0) / 1000).toFixed(1)}s · cost $${costSoFarUsd().toFixed(4)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("latency probe failed:", err);
    process.exit(1);
  });
