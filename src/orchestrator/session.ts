import { runBlueprint } from "@/agents/blueprint";
import { runGrader } from "@/agents/grader";
import { runBankBuilder, runMcqQuestion } from "@/agents/mcq";
import { runQuestion } from "@/agents/question";
import { runReporter } from "@/agents/reporter";
import { classifyAnswer } from "@/core/answers";
import { gradeFromMcq, isValidMcq } from "@/core/mcq";
import { shuffleMcqOptions } from "@/core/shuffle";
import { roleWarmupOpener, templatedOpener } from "@/core/opener";
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

// Typed, expected failures. The API routes translate these into proper HTTP
// statuses (404 / 409) instead of leaking Prisma errors as opaque 500s.
export type DomainErrorCode =
  | "session_not_found"
  | "question_not_found"
  | "already_answered"
  | "session_done";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

// Prisma unique-constraint violation (P2002), duck-typed so this file does not
// depend on the generated client's error classes.
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002"
  );
}

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
  // The engine already decides the format: the 101 opener is a written question
  // (its depth drives the jump), every later round is a fast MCQ. There is exactly
  // one written question per topic, so no per-session text cap is needed.
  if (decision.format === "mcq") {
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
  const picked = await pickBankMcq(sessionId, topicId, topicState.name, decision.difficulty, language);

  // Shuffle BEFORE persisting: the generator LLM lists the correct option first
  // most of the time, so serving verbatim makes always-picking-A a winning
  // strategy. Persisting the shuffled order means the served payload and the
  // grading comparison agree by construction.
  const shuffled = shuffleMcqOptions(
    `${sessionId}:${order}:${picked.stem}`,
    picked.options,
    picked.correctIndex,
  );
  const mcq = { ...picked, options: shuffled.options, correctIndex: shuffled.correctIndex };

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
  // The 101 opener (discovery) is templated: no AI call, so Begin is fast and the
  // question is guaranteed to be a single plain prompt. Any other free-text
  // question (not currently produced by the engine) falls back to the agent.
  let text: string;
  let rubricPoints: string[];
  let gold: string;
  let level: number;
  if (decision.discovery) {
    const o = templatedOpener(topicState.name, language);
    text = o.text;
    rubricPoints = o.rubricPoints;
    gold = o.gold;
    level = o.level;
  } else {
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
    text = q.data.text;
    rubricPoints = q.data.rubricPoints;
    gold = q.data.gold;
    level = q.data.level;
  }

  const rubric: RubricJson = {
    points: rubricPoints,
    gold,
    level,
    maxScore: 100,
  };

  const row = await prisma.question.create({
    data: {
      sessionId,
      topicId,
      order,
      difficulty: decision.difficulty,
      text,
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
    text,
  };
}

// Build the full MCQ bank for a live (custom / specialized) role in the background.
// Runs off the Begin critical path so the first question is not blocked ~60s on the
// batch build. Non-fatal: any gap is covered by the single-MCQ fallback in
// pickBankMcq. Fire-and-forget on the long-lived local server.
async function buildLiveBank(
  sessionId: string,
  topics: { id: string; name: string }[],
  role: string,
  specialization: string | undefined,
  language: Language,
): Promise<void> {
  const norm = (s: string) => s.trim().toLowerCase();
  try {
    const bank = await runBankBuilder({
      role,
      specialization,
      topics: topics.map((t) => t.name),
      language,
    });
    const rows = bank.data.topics.flatMap((bt) => {
      const topicRow = topics.find((t) => norm(t.name) === norm(bt.name));
      if (!topicRow) return [];
      return bt.questions.flatMap((q) =>
        isValidMcq(q.options, q.correctIndex)
          ? [
              {
                sessionId,
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
    console.error("[startSession] background bank build failed, using live MCQ fallback:", err);
  }
}

// Build the MCQ bank for an already-started live session, loading everything it
// needs from the DB. Idempotent: a no-op if the bank is already populated (the
// pre-seeded template path fills it synchronously at start). Meant to be run AFTER
// startSession returns, off the Begin critical path, by whoever owns the process
// long enough to finish it: the API route via Next's after(), the CLI in the
// background. Never throws.
export async function buildSessionBank(sessionId: string): Promise<void> {
  try {
    const existing = await prisma.bankQuestion.count({ where: { sessionId } });
    if (existing > 0) return;
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { topics: { orderBy: { order: "asc" } } },
    });
    if (!session) return;
    await buildLiveBank(
      session.id,
      session.topics,
      session.role,
      session.specialization ?? undefined,
      session.language as Language,
    );
  } catch (err) {
    console.error("[buildSessionBank] failed, using live MCQ fallback:", err);
  }
}

export async function startSession(input: {
  role: string;
  specialization?: string;
  candidateName?: string;
  persona?: Persona;
  language?: Language;
}): Promise<StartResult> {
  const language: Language = input.language ?? "en";
  const specialization = input.specialization?.trim() || undefined;
  const candidateName = input.candidateName?.trim() || undefined;

  // Instant path: a pre-seeded template for a known role (the fixed role chips)
  // skips BOTH the blueprint and the bank build, so Begin is a pure DB clone.
  // A specialization scopes the assessment to a specific stack, so the generic
  // pre-seeded bank no longer fits: fall through to the live planner in that case.
  // Unknown / custom ("Other") roles also fall back to the live blueprint below.
  const template = specialization ? null : getRoleBank(input.role, language);

  // Live path (custom / specialized role): DEFER the blueprint. Building it is a
  // ~15s CLI spawn, and it is NOT needed to show the first question, so blocking
  // Begin on it is exactly the "weird wait" the user hit. Instead we show a
  // role-level warm-up INSTANTLY on a single provisional topic, and materialize the
  // real topics in the background (route after() / CLI) with a safety-net await on
  // the first submit. The warm-up's graded depth seeds the assessment's starting
  // level, and ensureBlueprint later renames this provisional topic to the
  // blueprint's top topic and adds the rest, so the session ends with exactly the
  // blueprint's topics (no extra umbrella topic).
  if (!template) {
    return startLiveSession({
      role: input.role,
      specialization,
      candidateName,
      persona: input.persona,
      language,
    });
  }

  const rawTopics: Array<{ name: string; importance: number; startLevel: number }> =
    template.topics;

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
      specialization: specialization ?? null,
      candidateName: candidateName ?? null,
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

  // Pre-seeded template: clone the full MCQ bank instantly (no AI). Non-fatal: if a
  // row is malformed the per-question fallback still produces MCQs.
  const norm = (s: string) => s.trim().toLowerCase();
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

// Start a live (custom / specialized) session WITHOUT waiting on the blueprint, so
// the first question appears instantly. Creates one provisional topic named after
// the role/stack, writes a role-level warm-up on it (no AI), and marks the session
// blueprintPending. materializeSession() fills in the real topics + MCQ bank in the
// background; submitAnswer() awaits ensureBlueprint as a safety net if the user
// answers before the background build finishes.
async function startLiveSession(input: {
  role: string;
  specialization?: string;
  candidateName?: string;
  persona?: Persona;
  language: Language;
}): Promise<StartResult> {
  const { language } = input;
  const subject = input.specialization ?? input.role;
  const opener = roleWarmupOpener(subject, language);
  const provisional = initTopicState({ name: subject, importance: 1, startLevel: opener.level });

  const session = await prisma.session.create({
    data: {
      role: input.role,
      specialization: input.specialization ?? null,
      candidateName: input.candidateName ?? null,
      persona: input.persona ? JSON.stringify(input.persona) : null,
      language,
      status: "active",
      blueprintPending: true,
      topics: {
        create: [
          {
            name: provisional.name,
            order: 0,
            importance: provisional.importance,
            theta: provisional.theta,
            sigma: provisional.sigma,
            startLevel: provisional.startLevel,
            questionsAsked: 1,
            answeredCount: 0,
            consecutiveStrong: 0,
            converged: false,
            points: 0,
          },
        ],
      },
    },
    include: { topics: true },
  });

  const topicRow = session.topics[0];
  const rubric: RubricJson = {
    points: opener.rubricPoints,
    gold: opener.gold,
    level: opener.level,
    maxScore: 100,
  };
  const qRow = await prisma.question.create({
    data: {
      sessionId: session.id,
      topicId: topicRow.id,
      order: 1,
      difficulty: opener.level,
      text: opener.text,
      rubric: JSON.stringify(rubric),
      maxScore: 100,
      format: "text",
    },
  });

  return {
    ok: true,
    sessionId: session.id,
    question: {
      questionId: qRow.id,
      order: 1,
      topicName: topicRow.name,
      difficulty: opener.level,
      ceilingProbe: false,
      discovery: true,
      format: "text",
      text: opener.text,
    },
  };
}

// In-flight blueprint builds, keyed by session, so the background job (route
// after() / CLI) and the first submit that both call ensureBlueprint share ONE
// build instead of each spawning a redundant ~15s blueprint. They run in the same
// server process, so a module-level map dedupes them: the second caller awaits the
// same promise. Cleared when the build settles.
const _blueprintInFlight = new Map<string, Promise<void>>();

// Materialize the real topic blueprint for a live-path session whose warm-up was
// shown before the blueprint finished. Idempotent and safe to call from both the
// background job and the first submit (concurrent calls are coalesced). Renames the
// provisional warm-up topic to the blueprint's top topic (keeping its id, theta, and
// the already-answered warm-up) and adds the rest, so the session ends with exactly
// the blueprint's topics. Never throws.
export function ensureBlueprint(sessionId: string): Promise<void> {
  const existing = _blueprintInFlight.get(sessionId);
  if (existing) return existing;
  const p = ensureBlueprintOnce(sessionId).finally(() => {
    _blueprintInFlight.delete(sessionId);
  });
  _blueprintInFlight.set(sessionId, p);
  return p;
}

async function ensureBlueprintOnce(sessionId: string): Promise<void> {
  try {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || !session.blueprintPending) return; // template path, or already built

    const language = session.language as Language;
    const persona: Persona | undefined = session.persona
      ? (JSON.parse(session.persona) as Persona)
      : undefined;

    const blueprint = await runBlueprint({
      role: session.role,
      specialization: session.specialization ?? undefined,
      persona,
      language,
    });
    const usable =
      blueprint.data.assessable && blueprint.data.topics.length > 0
        ? blueprint.data.topics
        : [];
    const normalized = normalizeImportanceTo1000(usable.map((t) => t.importance));

    // Apply once, atomically. A concurrent caller (background vs first submit) that
    // loses the claim (blueprintPending already cleared) returns without touching
    // anything, so topics are never double-created.
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.session.findUnique({
        where: { id: sessionId },
        include: { topics: { orderBy: { order: "asc" } } },
      });
      if (!fresh || !fresh.blueprintPending) return;
      const provisionalTopic = fresh.topics[0];

      // Empty/nonsense blueprint: keep the provisional warm-up topic as the sole
      // scored topic so the session still completes rather than dead-ending. Give it
      // the full weight so a direct DB read matches what scoring renormalizes to.
      if (usable.length === 0) {
        await tx.topic.update({
          where: { id: provisionalTopic.id },
          data: { importance: 1000 },
        });
        await tx.session.update({ where: { id: sessionId }, data: { blueprintPending: false } });
        return;
      }

      // The provisional topic BECOMES the blueprint's top topic.
      await tx.topic.update({
        where: { id: provisionalTopic.id },
        data: {
          name: usable[0].name,
          importance: normalized[0],
          startLevel: usable[0].startLevel,
        },
      });
      // The remaining topics are added fresh (they start at the opener floor and get
      // seeded to the running ability when the engine first reaches them).
      if (usable.length > 1) {
        const extra = usable.slice(1).map((t, i) => {
          const st = initTopicState({
            name: t.name,
            importance: normalized[i + 1],
            startLevel: t.startLevel,
          });
          return {
            sessionId,
            name: st.name,
            order: i + 1,
            importance: st.importance,
            theta: st.theta,
            sigma: st.sigma,
            startLevel: st.startLevel,
            questionsAsked: 0,
            answeredCount: 0,
            consecutiveStrong: 0,
            converged: false,
            points: 0,
          };
        });
        await tx.topic.createMany({ data: extra });
      }
      await tx.session.update({ where: { id: sessionId }, data: { blueprintPending: false } });
    });
  } catch (err) {
    // Give up gracefully rather than re-spawning a failing blueprint on EVERY later
    // submit (which would add ~15s to every answer). Clear the flag so the session
    // falls back to the single provisional warm-up topic and still completes. Only
    // reweight when the blueprint never applied (still the sole provisional topic);
    // never overwrite a split that a prior call built successfully.
    console.error("[ensureBlueprint] failed; warm-up topic will carry the session:", err);
    try {
      const topics = await prisma.topic.findMany({
        where: { sessionId },
        orderBy: { order: "asc" },
      });
      if (topics.length === 1) {
        await prisma.topic.update({
          where: { id: topics[0].id },
          data: { importance: 1000 },
        });
      }
      await prisma.session.update({
        where: { id: sessionId },
        data: { blueprintPending: false },
      });
    } catch {
      // best-effort: if even the fallback DB write fails, the flag stays set and a
      // later submit retries; the provisional topic still lets the session run.
    }
  }
}

// Finish the deferred work for a live session: build the real topics, then the MCQ
// bank for them. Both idempotent, so this is a no-op for a pre-seeded template
// session. Meant to run AFTER startSession returns (route after() / CLI background).
export async function materializeSession(sessionId: string): Promise<void> {
  await ensureBlueprint(sessionId);
  await buildSessionBank(sessionId);
}

// In-flight submits keyed by question, so a double-fired request (impatient
// double click, or a client retry racing a slow grader) awaits the SAME work
// instead of spawning a second grader call or tripping the Answer unique
// constraint. Same pattern as _blueprintInFlight; single server process, so a
// module-level map is enough. Cleared when the submit settles.
const _submitInFlight = new Map<string, Promise<AnswerResult>>();

export async function submitAnswer(input: {
  sessionId: string;
  questionId: string;
  answer: string;
}): Promise<AnswerResult> {
  const key = `${input.sessionId}:${input.questionId}`;
  const existing = _submitInFlight.get(key);
  if (existing) return existing;
  const p = submitAnswerOnce(input).finally(() => {
    _submitInFlight.delete(key);
  });
  _submitInFlight.set(key, p);
  return p;
}

async function submitAnswerOnce(input: {
  sessionId: string;
  questionId: string;
  answer: string;
}): Promise<AnswerResult> {
  // Safety net for the deferred (live) path: make sure the real topics exist before
  // the engine decides the next question. Idempotent and instant once the topics
  // are built, so it costs nothing on every later submit or on a template session.
  // The warm-up answer is graded against its own question either way; this only
  // guarantees the topic list the engine needs. If the user answered the warm-up
  // faster than the background build, they wait the remainder here (after engaging),
  // instead of at Begin.
  await ensureBlueprint(input.sessionId);

  const session = await prisma.session.findUnique({
    where: { id: input.sessionId },
    include: { topics: { orderBy: { order: "asc" } } },
  });
  if (!session) {
    throw new DomainError("session_not_found", "No such assessment session.");
  }
  const question = await prisma.question.findUnique({
    where: { id: input.questionId },
  });
  // A question from another session is "not found" here: grading it against this
  // session's topics would corrupt both sessions.
  if (!question || question.sessionId !== session.id) {
    throw new DomainError("question_not_found", "No such question in this session.");
  }
  const rubric = JSON.parse(question.rubric) as RubricJson;
  const language = session.language as Language;

  // Idempotent replay: if this question already has a graded answer (double-fired
  // request, or a retry after a crash later in the pipeline), rebuild the result
  // from the stored rows instead of grading again. This is what un-bricks a
  // session after a failure between persisting and responding.
  const existingAnswer = await prisma.answer.findUnique({
    where: { questionId: question.id },
    include: { evaluation: true },
  });
  if (existingAnswer?.evaluation) {
    return replayAnswerResult(session.id, existingAnswer.evaluation);
  }

  // Only replays of already graded questions are allowed on a non-active session;
  // new grading work on a finished (or abandoned) session is rejected.
  if (session.status !== "active") {
    throw new DomainError("session_done", "This assessment is already finished.");
  }

  let grade: Grade;
  let publicGrade: PublicGrade;
  let llmConfidence = 0;
  let answerRow: { id: string; text: string };

  if (question.format === "mcq") {
    // Deterministic scoring, no AI: the answer is the 0-based selected option.
    const options = safeParseArray(question.optionsJson ?? "[]");
    // A retry after a mid-submit crash grades the STORED answer text, so the
    // grade always matches what was persisted first. INVARIANT this relies on:
    // Answer.text for an MCQ is either the exact option text (valid pick) or
    // the raw submitted string (invalid pick, indexOf misses, falls through to
    // re-parsing the same raw string). If answerText persistence ever changes
    // shape, this replay lookup must change with it.
    const storedIndex = existingAnswer ? options.indexOf(existingAnswer.text) : -1;
    const selected = storedIndex >= 0 ? storedIndex : Number.parseInt(input.answer, 10);
    const valid = Number.isInteger(selected) && selected >= 0 && selected < options.length;
    const correct = valid && selected === question.correctIndex;
    const correctText =
      question.correctIndex != null ? (options[question.correctIndex] ?? "") : "";
    const answerText = valid ? options[selected] : input.answer;
    // Grade at the level of the item actually served (rubric.level), not the
    // level the engine asked for: the bank only holds levels 2/4/5/7/9, so the
    // nearest pick can differ from the requested difficulty.
    grade = gradeFromMcq(correct, rubric.level ?? question.difficulty);
    publicGrade = {
      score: grade.score,
      demonstratedLevel: grade.demonstratedLevel,
      matched: correct ? [correctText] : [],
      missing: correct ? [] : [correctText],
      feedback: correct ? "Correct." : `Not quite. The correct answer was: ${correctText}`,
    };
    answerRow = await ensureAnswerRow(question.id, answerText, existingAnswer);
  } else {
    // Answer-first persistence: store the user's text BEFORE the grader call, so
    // a grader failure never loses what they typed, and a retry of the same
    // submit grades the stored row instead of tripping the unique constraint.
    answerRow = await ensureAnswerRow(question.id, input.answer, existingAnswer);
    // Degenerate answers are scored 0 in code, saving a grading call; otherwise
    // the grader agent judges the stored text.
    const classification = classifyAnswer(answerRow.text);
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
        answer: answerRow.text,
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

  // Update the graded topic through the pure engine.
  const topicRow = session.topics.find((t) => t.id === question.topicId);
  if (!topicRow) throw new Error("graded question has no matching topic");
  const before = toTopicState(topicRow);
  const after = applyGrade(before, grade);

  // Rebuild the full state list with this topic updated.
  const states = session.topics.map((row) =>
    row.id === topicRow.id ? after : toTopicState(row),
  );
  const totalAnswered = states.reduce((sum, t) => sum + t.answeredCount, 0);

  // Evaluation, topic update, and level-curve snapshot land atomically, so
  // "evaluation exists" always implies "topic updated". That invariant is what
  // makes the replay path above safe to trust.
  try {
    await prisma.$transaction([
      prisma.evaluation.create({
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
      }),
      prisma.topic.update({
        where: { id: topicRow.id },
        data: {
          theta: after.theta,
          sigma: after.sigma,
          answeredCount: after.answeredCount,
          consecutiveStrong: after.consecutiveStrong,
          converged: after.converged,
        },
      }),
      prisma.abilitySnapshot.create({
        data: {
          sessionId: session.id,
          topicId: topicRow.id,
          order: totalAnswered,
          theta: after.theta,
          sigma: after.sigma,
        },
      }),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      // A concurrent submit (another process on the same DB) evaluated this
      // answer first; its stored result is authoritative, so replay it.
      const winner = await prisma.answer.findUnique({
        where: { questionId: question.id },
        include: { evaluation: true },
      });
      if (winner?.evaluation) return replayAnswerResult(session.id, winner.evaluation);
      throw new DomainError("already_answered", "This question was already answered.");
    }
    throw err;
  }

  return continueSession(session, states, totalAnswered, publicGrade);
}

// Find-or-create the Answer row for a question. Tolerates a concurrent create
// from another process (Answer is unique on questionId) by re-reading the winner.
async function ensureAnswerRow(
  questionId: string,
  text: string,
  existing: { id: string; text: string } | null,
): Promise<{ id: string; text: string }> {
  if (existing) return existing;
  try {
    return await prisma.answer.create({ data: { questionId, text } });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await prisma.answer.findUnique({ where: { questionId } });
      if (winner) return winner;
    }
    throw err;
  }
}

// Rebuild the AnswerResult for a question that already has a stored evaluation.
// Reads fresh session state (the evaluation and its topic update land in one
// transaction, so the topics already reflect this grade) and re-runs the
// deterministic decide step, so a double-fired or retried submit gets the same
// result the original call would have returned.
async function replayAnswerResult(
  sessionId: string,
  evaluation: {
    score: number;
    demonstratedLevel: number;
    matched: string;
    missing: string;
    feedback: string;
  },
): Promise<AnswerResult> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { topics: { orderBy: { order: "asc" } } },
  });
  if (!session) {
    throw new DomainError("session_not_found", "No such assessment session.");
  }

  const publicGrade: PublicGrade = {
    score: evaluation.score,
    demonstratedLevel: evaluation.demonstratedLevel,
    matched: safeParseArray(evaluation.matched),
    missing: safeParseArray(evaluation.missing),
    feedback: evaluation.feedback,
  };

  // Finished session: the stored report IS the previously computed result.
  if (session.status === "done" && session.reportJson) {
    return {
      done: true,
      grade: publicGrade,
      report: JSON.parse(session.reportJson) as SessionReport,
    };
  }

  const states = session.topics.map(toTopicState);
  const totalAnswered = states.reduce((sum, t) => sum + t.answeredCount, 0);
  return continueSession(session, states, totalAnswered, publicGrade);
}

// The shared "what happens after a graded answer" step: ask the pure engine to
// decide, then either serve the next question or finish. Used by the fresh
// grading path and by idempotent replays, so both produce the same shape.
async function continueSession(
  session: {
    id: string;
    role: string;
    specialization: string | null;
    candidateName: string | null;
    persona: string | null;
    language: string;
    topics: { id: string; name: string }[];
  },
  states: TopicState[],
  totalAnswered: number,
  publicGrade: PublicGrade,
): Promise<AnswerResult> {
  const language = session.language as Language;
  const persona: Persona | undefined = session.persona
    ? (JSON.parse(session.persona) as Persona)
    : undefined;

  const decision = decide(states, totalAnswered);

  if (decision.kind === "ask") {
    // Replay guard: an earlier attempt (or a raced duplicate) may already have
    // created the next question. Serve the stored row instead of generating a
    // second one, so bank items are not burned twice and orders stay unique.
    // CONTRACT: "answer: null" means the Answer relation row does not exist yet;
    // answering creates the Answer row (the relation), nothing ever writes a
    // placeholder Answer for an unanswered question. If that ever changes, this
    // guard would wrongly re-serve answered questions.
    const open = await prisma.question.findFirst({
      where: { sessionId: session.id, order: totalAnswered + 1, answer: null },
    });
    if (open) {
      const openTopic = session.topics.find((t) => t.id === open.topicId);
      return {
        done: false,
        grade: publicGrade,
        question: {
          questionId: open.id,
          order: open.order,
          topicName: openTopic?.name ?? "",
          difficulty: open.difficulty,
          ceilingProbe: decision.ceilingProbe,
          discovery: decision.discovery,
          format: open.format === "mcq" ? "mcq" : "text",
          text: open.text,
          ...(open.format === "mcq"
            ? { options: safeParseArray(open.optionsJson ?? "[]") }
            : {}),
        },
      };
    }

    const nextTopicRow = session.topics[decision.topicIndex];
    const nextState = states[decision.topicIndex];
    // Carry the running ability into a FRESH topic so it continues at the
    // candidate's level instead of resetting to an easy warm-up.
    if (decision.seedTheta !== undefined && nextState.answeredCount === 0) {
      await prisma.topic.update({
        where: { id: nextTopicRow.id },
        data: { theta: decision.seedTheta },
      });
      nextState.theta = decision.seedTheta;
    }
    const question2 = await askQuestion(
      session.id,
      nextTopicRow.id,
      nextState,
      decision,
      language,
      persona,
      totalAnswered + 1,
    );
    return { done: false, grade: publicGrade, question: question2 };
  }

  // Done: score, report, persist. finishSession is retry-safe: if the reporter
  // fails here, every evaluation is already stored, and a retry of the same
  // submit replays into finishSession to regenerate the report.
  const report = await finishSession(
    session.id,
    states,
    session.role,
    language,
    session.candidateName ?? undefined,
    session.specialization ?? undefined,
  );
  return { done: true, grade: publicGrade, report };
}

async function finishSession(
  sessionId: string,
  states: TopicState[],
  role: string,
  language: Language,
  candidateName?: string,
  specialization?: string,
): Promise<SessionReport> {
  // Retry-safe: a previous attempt may have stored the report but lost the
  // response, or a replayed submit may land here after the fact. Serve the
  // stored report instead of re-running the reporter agent.
  const existing = await prisma.session.findUnique({ where: { id: sessionId } });
  if (existing?.reportJson) {
    return JSON.parse(existing.reportJson) as SessionReport;
  }

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
    specialization,
    candidateName,
    language,
    total: score.total,
    confidenceInterval: score.confidenceInterval,
    overallLabel: score.overallLabel,
    // Only topics that were actually assessed (importance > 0 after renormalization).
    // Untested topics must not be reported as "weak", they were simply never reached.
    topics: score.topics
      .filter((t) => t.importance > 0)
      .map((t) => ({
        name: t.name,
        theta: t.theta,
        points: t.points,
        label: t.label,
      })),
    highlights,
  });

  const sessionReport: SessionReport = {
    ...score,
    candidateName,
    role,
    specialization,
    language,
    summary: report.data.summary,
    verdict: report.data.verdict,
    weakPoints: report.data.weakPoints,
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
