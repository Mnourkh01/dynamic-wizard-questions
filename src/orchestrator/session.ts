import { runBlueprint } from "@/agents/blueprint";
import { runGrader } from "@/agents/grader";
import { runQuestion } from "@/agents/question";
import { runReporter } from "@/agents/reporter";
import { classifyAnswer } from "@/core/answers";
import { difficultyBrief } from "@/core/ladder";
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
import { normalizeWeightsTo1000 } from "@/core/scoring";
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
  weight: number;
  theta: number;
  sigma: number;
  firstPickPrior: number;
  questionsAsked: number;
  answeredCount: number;
  consecutiveStrong: number;
  converged: boolean;
  points: number;
}): TopicState {
  return {
    name: row.name,
    weight: row.weight,
    theta: row.theta,
    sigma: row.sigma,
    firstPickPrior: row.firstPickPrior,
    questionsAsked: row.questionsAsked,
    answeredCount: row.answeredCount,
    consecutiveStrong: row.consecutiveStrong,
    converged: row.converged,
    points: row.points,
  };
}

// Generate + persist the next question for a decided topic, then return it.
async function askQuestion(
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
    text: q.data.text,
  };
}

export async function startSession(input: {
  role: string;
  persona?: Persona;
  language?: Language;
}): Promise<StartResult> {
  const language: Language = input.language ?? "en";

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

  // Normalize weights to exactly 1000 in code, never in the model.
  const weights = normalizeWeightsTo1000(blueprint.data.topics.map((t) => t.weight));
  const blueprintTopics: TopicBlueprint[] = blueprint.data.topics.map((t, i) => ({
    name: t.name,
    weight: weights[i],
    prior: t.prior,
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
          weight: s.weight,
          theta: s.theta,
          sigma: s.sigma,
          firstPickPrior: s.firstPickPrior,
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

  // Degenerate answers are scored 0 in code, saving an Opus grading call.
  const classification = classifyAnswer(input.answer);
  let grade: Grade;
  let publicGrade: PublicGrade;
  let llmConfidence = 0;

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

  // Persist the answer + its evaluation.
  const answerRow = await prisma.answer.create({
    data: { questionId: question.id, text: input.answer },
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
