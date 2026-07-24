import type { FinalScore } from "@/core/types";

// Public, serializable shapes shared between the orchestrator (server) and the
// wizard UI (client). No runtime imports, so a client component can import these
// without pulling in Prisma or the SDK.

export interface QuestionPayload {
  questionId: string;
  order: number;
  topicName: string;
  difficulty: number;
  ceilingProbe: boolean;
  discovery: boolean;
  format: "mcq" | "text";
  text: string;
  // Present for mcq only. The correct index is NEVER sent to the client.
  options?: string[];
}

export interface PublicGrade {
  score: number;
  demonstratedLevel: number;
  matched: string[];
  missing: string[];
  feedback: string;
}

export interface SessionReport extends FinalScore {
  // Context shown on the report header. candidateName + specialization are optional.
  candidateName?: string;
  role: string;
  specialization?: string;
  language: "en" | "ar";
  verdict: string;
  summary: string;
  weakPoints: { area: string; issue: string }[];
  perTopic: { name: string; strengths: string[]; gaps: string[] }[];
  learningPath: string[];
}

export type StartResult =
  | { ok: true; sessionId: string; question: QuestionPayload }
  | { ok: false; reason: string };

export type AnswerResult =
  | { done: false; grade: PublicGrade; question: QuestionPayload }
  | { done: true; grade: PublicGrade; report: SessionReport };

// The resume snapshot for a session: everything the UI (or the CLI --resume flag)
// needs to pick up exactly where the candidate left off after a refresh or crash.
// Served by GET /api/sessions/[id]; built by getSessionState (a pure read, it
// never generates questions or reports).
export interface SessionStateResult {
  ok: true;
  done: boolean;
  candidateName?: string;
  role: string;
  specialization?: string;
  language: "en" | "ar";
  totalQuestions: number; // GLOBAL_MAX_QUESTIONS
  answeredCount: number; // questions answered so far in the whole session
  question: QuestionPayload | null; // open question when not done
  report: SessionReport | null; // stored report when done, else null
}
