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
  summary: string;
  perTopic: { name: string; strengths: string[]; gaps: string[] }[];
  learningPath: string[];
}

export type StartResult =
  | { ok: true; sessionId: string; question: QuestionPayload }
  | { ok: false; reason: string };

export type AnswerResult =
  | { done: false; grade: PublicGrade; question: QuestionPayload }
  | { done: true; grade: PublicGrade; report: SessionReport };
