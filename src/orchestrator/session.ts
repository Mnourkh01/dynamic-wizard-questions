import { runBlueprint } from "@/agents/blueprint";
import { runGrader } from "@/agents/grader";
import { runBankBuilder, runMcqQuestion } from "@/agents/mcq";
import { runQuestion } from "@/agents/question";
import { runReporter } from "@/agents/reporter";
import { classifyAnswer } from "@/core/answers";
import { MAX_TEXT_PROBES } from "@/core/constants";
import { gradeFromMcq, isValidMcq } from "@/core/mcq";
import { difficultyBrief } from "@/core/ladder";
import { getRoleBank } from "@/data/role-banks";
import { applyGrade, decide, deterministicConfidence, initTopicState } from "@/core/policy";
import { computeFinalScore } from "@/core/scoring";
import type {
  EngineDecision,
  Grade,
  Language,
  Persona,
  TopicBlueprint,
  TopicState,
} from "@/core/types";
import { normalizeImportanceTo1000 } from "@/core/scoring";
import { prisma } from "@/db/client";
import type {
  AnswerResult,
  PublicGrade,
  QuestionPayload,
  SessionReport,
  StartResult,
} from "@/lib/types";

// The orchestrator is the I/O shell around the pure core. It calls agents,
// persists every step, and asks core/policy for every numeric decision. Because
// full state lives in the DB and each call is self-contained, the same two
// functions drive the CLI harness (Phase 1), the HTTP API (Phase 2), and resume.

export type {
  AnswerResult,
  PublicGrade,
  QuestionPayload,
  SessionReport,
  StartResult,
} from "@/lib/types";

interface RubricJson {
  points: string[];
  gold: string;
  level: number;
  maxScore: number;
}

function toTopicState(row: {
  name: string;
  importance: number;
  theta: number;
  sigma: number;
  startLevel: number;
  questionsAsked: number;
  answeredCount: number;
  consecutiveStrong: number;
  converged: boolean;
  points: number;
}): TopicState {
  return {
    name: row.name,
    importance: row.importance,
    theta: row.theta,
    sigma: row.sigma,
    startLevel: row.startLevel,
    questionsAsked: row.questionsAsked,
    answeredCount: row.answeredCount,
    consecutiveStrong: row.consecutiveStrong,
    converged: row.converged,
    points: row.points,
  };
}

// Generate + persist the next question for a decided topic, then return it. The
// engine's decision.format chooses the path: "mcq" is served from the pre-built
// bank (pure DB, no AI, with a single-question live fallback); "text" is a
// free-text depth probe written by the question agent and graded by AI.
async function askQuestion(
  sessionId: string,
  topicId: string,
  topicState: TopicState,
  decision: Extract<EngineDecision, { kind: "ask" }>,
  language: Language,
  persona: Persona | undefined,
  order: number,
): Promise<QuestionPayload> {
  let format = decision.format;
  // Cap the slow free-text depth probes per session. Once spent, later ceiling
  // probes fall back to a harder MCQ so a strong candidate never pays for a text
  // grade on every topic.
  if (format === "text") {
    const textAsked = await prisma.question.count({ where: { sessionId, format: "text" } });
    if (textAsked >= MAX_TEXT_PROBES) format = "mcq";
  }
  if (format === "mcq") {
    return askMcq(sessionId, topicId, topicState, decision, language, order);
  }
  return askText(sessionId, topicId, topicState, decision, language, persona, order);
}

// Pull the next MCQ for a topic from the pre-generated pool, nearest to the target
// difficulty, marking it used. Falls back to a single live MCQ if the pool is
// empty (batch builder under-produced or failed at start).
async function pickBankMcq(
  sessionId: string,
  topicId: string,
  topicName: string,
  difficulty: number,
  language: Language,
): Promise<{ stem: string; options: string[]; correctIndex: number; level: number }> {
  // Only serve well-formed bank rows. A malformed correctIndex must never be
  // silently coerced to 0 (that would mark option 0 as the correct answer).
  const pool = (await prisma.bankQuestion.findMany({ where: { topicId, used: false } }))
    .map((row) => ({ row, options: safeParseArray(row.optionsJson) }))
    .filter(({ row, options }) => isValidMcq(options, row.correctIndex));

  if (pool.length > 0) {
    pool.sort(
      (a, b) => Math.abs(a.row.level - difficulty) - Math.abs(b.row.level - difficulty),
    );
    const { row, options } = pool[0];
    await prisma.bankQuestion.update({ where: { id: row.id }, data: { used: true } });
    return { stem: row.stem, options, correctIndex: row.correctIndex, level: row.level };
  }

  // Pool exhausted (or all malformed): generate one MCQ live, retrying until it is
  // well-formed rather than serving a question whose correct answer is unknown.
  const asked = await prisma.question.findMany({ where: { sessionId }, select: { text: true } });
  for (let attempt = 0; attempt < 2; attempt++) {
    const gen = await runMcqQuestion({
      topic: topicName,
      level: difficulty,
      language,
      alreadyAsked: asked.map((a) => a.text),
    });
    if (isValidMcq(gen.data.options, gen.data.correctIndex)) {
      return {
        stem: gen.data.stem,
        options: gen.data.options,
        correctIndex: gen.data.correctIndex,
        level: gen.data.level,
      };
    }
  }
  throw new Error(`could not generate a valid MCQ for topic "${topicName}"`);
}

async function askMcq(
  sessionId: string,
  topicId: string,
  topicState: TopicState,
  decision: Extract<EngineDecision, { kind: "ask" }>,
  language: Language,
  order: number,
): Promise<QuestionPayload> {
  const mcq = await pickBankMcq(sessionId, topicId, topicState.name, decision.difficulty, language);

  // The grader never runs on an MCQ, but Question.rubric is required; store a
  // minimal rubric (the correct option) so the row shape stays consistent.
  const rubric: RubricJson = {
    points: [mcq.options[mcq.correctIndex]],
    gold: mcq.options[mcq.correctIndex],
    level: mcq.level,
    maxScore: 100,
  };

  const row = await prisma.question.create({
    data: {
      sessionId,
      topicId,
      order,
      difficulty: decision.difficulty,
      text: mcq.stem,
      rubric: JSON.stringify(rubric),
      maxScore: 100,
      format: "mcq",
      optionsJson: JSON.stringify(mcq.options),
      correctIndex: mcq.correctIndex,
    },
  });

  await prisma.topic.update({
    where: { id: topicId },
    data: { questionsAsked: { increment: 1 } },
  });

  return {
    questionId: row.id,
    order,
    topicName: topicState.name,
    difficulty: decision.difficulty,
    ceilingProbe: decision.ceilingProbe,
    discovery: decision.discovery,
    format: "mcq",
    text: mcq.stem,
    options: mcq.options,
  };
}

async function askText(
  sessionId: string,
  topicId: string,
  topicState: TopicState,
  decision: Extract<EngineDecision, { kind: "ask" }>,
  language: Language,
  persona: Persona | undefined,
  order: number,
): Promise<QuestionPayload> {
  const asked = await prisma.question.findMany({
    where: { sessionId },
    select: { text: true },
  });

  const q = await runQuestion({
    topic: topicState.name,
    difficulty: decision.difficulty,
    difficultyBrief: difficultyBrief(decision.difficulty),
    discovery: decision.discovery,
    persona,
    alreadyAsked: asked.map((a) => a.text),
    language,
  });

  const rubric: RubricJson = {
    points: q.data.rubricPoints,
    gold: q.data.gold,
    level: q.data.level,
    maxScore: 100,
  };

  const row = await prisma.question.create({
    data: {
      sessionId,
      topicId,
      order,
      difficulty: decision.difficulty,
      text: q.data.text,
      rubric: JSON.stringify(rubric),
      maxScore: 100,
      format: "text",
    },
  });

  await prisma.topic.update({
    where: { id: topicId },
    data: { questionsAsked: { increment: 1 } },
  });

  return {
    questionId: row.id,
    order,
    topicName: topicState.name,
    difficulty: decision.difficulty,
    ceilingProbe: decision.ceilingProbe,
    discovery: decision.discovery,
    format: "text",
    text: q.data.text,
  };
}

export async function startSession(input: {
  role: string;
  persona?: Persona;
  language?: Language;
}): Promise<StartResult> {
  const language: Language = input.language ?? "en";

  // Instant path: a pre-seeded template for a known role (the fixed role chips)
  // skips BOTH the blueprint and the bank build, so Begin is a pure DB clone.
  // Unknown / custom ("Other") roles fall back to the live blueprint below.
  const template = getRoleBank(input.role, language);

  let rawTopics: Array<{ name: string; importance: number; startLevel: number }>;
  if (template) {
    rawTopics = template.topics;
  } else {
    const blueprint = await runBlueprint({
      role: input.role,
      persona: input.persona,
      language,
    });
    if (!blueprint.data.assessable || blueprint.data.topics.length === 0) {
      return {
        ok: false,
        reason:
          "This role could not be turned into a skill assessment. Try a more specific job title.",
      };
    }
    rawTopics = blueprint.data.topics;
  }

  // Normalize importance to exactly 1000 in code, never in the model.
  const normalized = normalizeImportanceTo1000(rawTopics.map((t) => t.importance));
  const blueprintTopics: TopicBlueprint[] = rawTopics.map((t, i) => ({
    name: t.name,
    importance: normalized[i],
    startLevel: t.startLevel,
  }));
  const states = blueprintTopics.map(initTopicState);

  const session = await prisma.session.create({
    data: {
      role: input.role,
      persona: input.persona ? JSON.stringify(input.persona) : null,
      language,
      status: "active",
      topics: {
        create: states.map((s, i) => ({
          name: s.name,
          order: i,
          importance: s.importance,
          theta: s.theta,
          sigma: s.sigma,
          startLevel: s.startLevel,
          questionsAsked: 0,
          answeredCount: 0,
          consecutiveStrong: 0,
          converged: false,
          points: 0,
        })),
      },
    },
    include: { topics: { orderBy: { order: "asc" } } },
  });

  // Populate the MCQ bank. A pre-seeded template clones instantly (no AI); an
  // unknown role builds the pool live in ONE batch call. Both are non-fatal: if a
  // live build fails, the per-question fallback still produces MCQs.
  const norm = (s: string) => s.trim().toLowerCase();
  if (template) {
    const rows = template.bank.flatMap((q) => {
      const topicRow = session.topics.find((t) => norm(t.name) === norm(q.topicName));
      if (!topicRow || !isValidMcq(q.options, q.correctIndex)) return [];
      return [
        {
          sessionId: session.id,
          topicId: topicRow.id,
          level: q.level,
          stem: q.stem,
          optionsJson: JSON.stringify(q.options),
          correctIndex: q.correctIndex,
        },
      ];
    });
    if (rows.length > 0) await prisma.bankQuestion.createMany({ data: rows });
  } else {
    try {
      const bank = await runBankBuilder({
        role: input.role,
        topics: session.topics.map((t) => t.name),
        language,
      });
      const rows = bank.data.topics.flatMap((bt) => {
        const topicRow = session.topics.find((t) => norm(t.name) === norm(bt.name));
        if (!topicRow) return [];
        return bt.questions.flatMap((q) =>
          isValidMcq(q.options, q.correctIndex)
            ? [
                {
                  sessionId: session.id,
                  topicId: topicRow.id,
                  level: q.level,
                  stem: q.stem,
                  optionsJson: JSON.stringify(q.options),
                  correctIndex: q.correctIndex,
                },
              ]
            : [],
        );
      });
      if (rows.length > 0) await prisma.bankQuestion.createMany({ data: rows });
    } catch (err) {
      console.error("[startSession] bank build failed, using live MCQ fallback:", err);
    }
  }

  const decision = decide(states, 0);
  if (decision.kind !== "ask") {
    return { ok: false, reason: "The engine produced no first question." };
  }

  const topicRow = session.topics[decision.topicIndex];
  const question = await askQuestion(
    session.id,
    topicRow.id,
    states[decision.topicIndex],
    decision,
    language,
    input.persona,
    1,
  );

  return { ok: true, sessionId: session.id, question };
}

export async function submitAnswer(input: {
  sessionId: string;
  questionId: string;
  answer: string;
}): Promise<AnswerResult> {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: input.sessionId },
    include: { topics: { orderBy: { order: "asc" } } },
  });
  const question = await prisma.question.findUniqueOrThrow({
    where: { id: input.questionId },
  });
  const rubric = JSON.parse(question.rubric) as RubricJson;
  const language = session.language as Language;
  const persona: Persona | undefined = session.persona
    ? (JSON.parse(session.persona) as Persona)
    : undefined;

  let grade: Grade;
  let publicGrade: PublicGrade;
  let llmConfidence = 0;
  let answerText = input.answer;

  if (question.format === "mcq") {
    // Deterministic scoring, no AI: the answer is the 0-based selected option.
    const options = safeParseArray(question.optionsJson ?? "[]");
    const selected = Number.parseInt(input.answer, 10);
    const valid = Number.isInteger(selected) && selected >= 0 && selected < options.length;
    const correct = valid && selected === question.correctIndex;
    const correctText =
      question.correctIndex != null ? (options[question.correctIndex] ?? "") : "";
    answerText = valid ? options[selected] : input.answer;
    grade = gradeFromMcq(correct, question.difficulty);
    publicGrade = {
      score: grade.score,
      demonstratedLevel: grade.demonstratedLevel,
      matched: correct ? [correctText] : [],
      missing: correct ? [] : [correctText],
      feedback: correct ? "Correct." : `Not quite. The correct answer was: ${correctText}`,
    };
  } else {
    // Free-text depth probe. Degenerate answers are scored 0 in code, saving a
    // grading call; otherwise the grader agent judges it.
    const classification = classifyAnswer(input.answer);
    if (classification.degenerate) {
      grade = {
        score: 0,
        demonstratedLevel: 1,
        matchedCount: 0,
        missingCount: rubric.points.length,
        degenerate: true,
      };
      publicGrade = {
        score: 0,
        demonstratedLevel: 1,
        matched: [],
        missing: rubric.points,
        feedback: "No gradable answer was given for this question.",
      };
    } else {
      const graded = await runGrader({
        question: question.text,
        rubricPoints: rubric.points,
        gold: rubric.gold,
        answer: input.answer,
        language,
      });
      llmConfidence = graded.data.confidence;
      grade = {
        score: graded.data.score,
        demonstratedLevel: graded.data.demonstratedLevel,
        matchedCount: graded.data.matched.length,
        missingCount: graded.data.missing.length,
        degenerate: false,
      };
      publicGrade = {
        score: graded.data.score,
        demonstratedLevel: graded.data.demonstratedLevel,
        matched: graded.data.matched,
        missing: graded.data.missing,
        feedback: graded.data.feedback,
      };
    }
  }

  // Persist the answer + its evaluation.
  const answerRow = await prisma.answer.create({
    data: { questionId: question.id, text: answerText },
  });
  await prisma.evaluation.create({
    data: {
      answerId: answerRow.id,
      score: Math.round(grade.score),
      demonstratedLevel: grade.demonstratedLevel,
      llmConfidence,
      deterministicConfidence: deterministicConfidence(grade),
      matched: JSON.stringify(publicGrade.matched),
      missing: JSON.stringify(publicGrade.missing),
      misconceptions: JSON.stringify([]),
      feedback: publicGrade.feedback,
    },
  });

  // Update the graded topic through the pure engine and persist it.
  const topicRow = session.topics.find((t) => t.id === question.topicId);
  if (!topicRow) throw new Error("graded question has no matching topic");
  const before = toTopicState(topicRow);
  const after = applyGrade(before, grade);

  await prisma.topic.update({
    where: { id: topicRow.id },
    data: {
      theta: after.theta,
      sigma: after.sigma,
      answeredCount: after.answeredCount,
      consecutiveStrong: after.consecutiveStrong,
      converged: after.converged,
    },
  });

  // Rebuild the full state list with this topic updated.
  const states = session.topics.map((row) =>
    row.id === topicRow.id ? after : toTopicState(row),
  );
  const totalAnswered = states.reduce((sum, t) => sum + t.answeredCount, 0);

  // Snapshot for the level-over-time curve.
  await prisma.abilitySnapshot.create({
    data: {
      sessionId: session.id,
      topicId: topicRow.id,
      order: totalAnswered,
      theta: after.theta,
      sigma: after.sigma,
    },
  });

  const decision = decide(states, totalAnswered);

  if (decision.kind === "ask") {
    const nextTopicRow = session.topics[decision.topicIndex];
    const question2 = await askQuestion(
      session.id,
      nextTopicRow.id,
      states[decision.topicIndex],
      decision,
      language,
      persona,
      totalAnswered + 1,
    );
    return { done: false, grade: publicGrade, question: question2 };
  }

  // Done: score, report, persist.
  const report = await finishSession(session.id, states, session.role, language);
  return { done: true, grade: publicGrade, report };
}

async function finishSession(
  sessionId: string,
  states: TopicState[],
  role: string,
  language: Language,
): Promise<SessionReport> {
  const score = computeFinalScore(states);

  // Persist per-topic points + the headline.
  const topicRows = await prisma.topic.findMany({
    where: { sessionId },
    orderBy: { order: "asc" },
  });
  for (let i = 0; i < topicRows.length; i++) {
    await prisma.topic.update({
      where: { id: topicRows[i].id },
      data: { points: score.topics[i]?.points ?? 0 },
    });
  }

  // Gather answer highlights for the reporter (bounded).
  const evals = await prisma.evaluation.findMany({
    where: { answer: { question: { sessionId } } },
    include: { answer: { include: { question: { include: { topic: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const highlights = evals.slice(0, 12).map((e) => ({
    topic: e.answer.question.topic.name,
    question: e.answer.question.text,
    score: e.score,
    missing: safeParseArray(e.missing),
  }));

  const report = await runReporter({
    role,
    language,
    total: score.total,
    confidenceInterval: score.confidenceInterval,
    overallLabel: score.overallLabel,
    topics: score.topics.map((t) => ({
      name: t.name,
      theta: t.theta,
      points: t.points,
      label: t.label,
    })),
    highlights,
  });

  const sessionReport: SessionReport = {
    ...score,
    summary: report.data.summary,
    perTopic: report.data.perTopic,
    learningPath: report.data.learningPath,
  };

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: "done",
      finalScore: score.total,
      finishedAt: new Date(),
      reportJson: JSON.stringify(sessionReport),
    },
  });

  return sessionReport;
}

// Test/harness only: peek an MCQ's correct index so the CLI auto-candidate can
// simulate a candidate of a given level. Never called from the web app (which must
// never receive the correct index).
export async function peekMcqAnswer(
  questionId: string,
): Promise<{ correctIndex: number; optionCount: number } | null> {
  const q = await prisma.question.findUnique({ where: { id: questionId } });
  if (!q || q.format !== "mcq" || q.correctIndex == null) return null;
  const options = safeParseArray(q.optionsJson ?? "[]");
  return { correctIndex: q.correctIndex, optionCount: options.length };
}

// Load a finished session's report from the DB (for the report permalink).
// Does not re-run any agent; returns null if the session is not finished.
export async function getSessionReport(sessionId: string): Promise<SessionReport | null> {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || !session.reportJson) return null;
  return JSON.parse(session.reportJson) as SessionReport;
}

function safeParseArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}
