// Live always-A gaming regression against a RUNNING dev server.
// Creates a real session, answers the warm-up with a degenerate "x" (graded in
// pure code, no AI spawn), then picks option A on every MCQ. Costs exactly one
// claude spawn (the final reporter call).
//
// History: before the serve-time shuffle (commit 8d7ac56) this strategy scored
// 916/1000 "Advanced". After it, the verified run scored 351/1000 "Beginner".
//
// Usage: start the server first (npx next dev -p 3001), then:
//   npm run regression:always-a
// Exits 0 on PASS (score < 500 and not Advanced), 1 on FAIL.
const BASE = process.env.REGRESSION_BASE_URL || "http://localhost:3001";
const FAIL_SCORE = 500;

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

(async () => {
  const start = await post("/api/sessions", {
    role: "Backend Engineer",
    candidateName: `AlwaysA-Regression-${new Date().toISOString().slice(0, 10)}`,
    language: "en",
  });
  if (start.status !== 200 || !start.json.ok) {
    console.error("START FAILED", start.status, JSON.stringify(start.json));
    process.exit(1);
  }
  const sessionId = start.json.sessionId;
  let question = start.json.question;
  let corrects = 0;
  let mcqCount = 0;
  let report = null;

  for (let i = 0; i < 40 && question; i++) {
    const answer = question.format === "mcq" ? "0" : "x";
    const res = await post(`/api/sessions/${sessionId}/answer`, {
      questionId: question.questionId,
      answer,
    });
    if (res.status !== 200) {
      console.error("ANSWER FAILED", res.status, JSON.stringify(res.json));
      process.exit(1);
    }
    if (question.format === "mcq") {
      mcqCount++;
      if (res.json.grade && res.json.grade.score >= 50) corrects++;
    }
    if (res.json.done) {
      report = res.json.report;
      question = null;
    } else {
      question = res.json.question;
    }
  }

  const total = report ? report.total : null;
  const label = report ? report.overallLabel || "" : "";
  const pass =
    total !== null && total < FAIL_SCORE && !/advanced/i.test(label);

  console.log(
    JSON.stringify(
      { sessionId, mcqCount, corrects, total, label, pass },
      null,
      2,
    ),
  );
  console.log(pass ? "ALWAYS-A REGRESSION: PASS" : "ALWAYS-A REGRESSION: FAIL");
  process.exit(pass ? 0 : 1);
})();
