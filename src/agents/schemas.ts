import { z } from "zod";
import {
  AFFORDANCES,
  ANTI_SIGNALS,
  CALIBRATION_SIGNALS,
  CONCRETENESS_SIGNALS,
  CONDITIONALITY_SIGNALS,
  COVERAGE_SIGNALS,
  FAILURE_SIGNALS,
  MECHANISM_SIGNALS,
  STRUCTURE_LEVELS,
} from "@/core/signals";

// Zod output contracts for every agent. These are the single source of truth for
// what each agent must return; runAgent converts them to JSON schema for the CLI
// and re-validates the response, so agent results are always typed, bounded data.

// --- Blueprint -------------------------------------------------------------
export const BlueprintTopicSchema = z.object({
  name: z.string().min(1).describe("A specific, non-overlapping skill area for this role"),
  importance: z
    .number()
    .int()
    .min(1)
    .describe("How much this topic counts toward the score, as a positive integer on any scale; code normalizes these to sum 1000"),
  startLevel: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("A starting level guess 1-10 for someone matching the persona; only aims the first question"),
});

export const BlueprintOutputSchema = z.object({
  assessable: z
    .boolean()
    .describe("false ONLY if the role is nonsense or impossible to assess as a skill"),
  topics: z.array(BlueprintTopicSchema).max(8).describe("3 to 8 topics when assessable; empty if not"),
});
export type BlueprintOutput = z.infer<typeof BlueprintOutputSchema>;

// --- Question --------------------------------------------------------------
export const QuestionOutputSchema = z.object({
  text: z.string().min(1).describe("The single question, in the requested language"),
  rubricPoints: z
    .array(z.string().min(1))
    .min(2)
    .max(8)
    .describe("The key points a strong answer must cover"),
  gold: z.string().min(1).describe("A concise reference answer covering the rubric"),
  level: z.number().int().min(1).max(10).describe("The level this question probes"),
});
export type QuestionOutput = z.infer<typeof QuestionOutputSchema>;

// --- Grader ----------------------------------------------------------------
export const GradeOutputSchema = z.object({
  score: z.number().min(0).max(100).describe("Rubric coverage + correctness, NOT length or fluency"),
  demonstratedLevel: z.number().int().min(1).max(10).describe("The level this answer actually shows"),
  matched: z
    .array(z.string())
    .describe("Rubric points the answer covered, each with a short supporting quote from the answer"),
  missing: z.array(z.string()).describe("Rubric points the answer failed to cover"),
  misconceptions: z.array(z.string()).describe("Confident but wrong claims in the answer"),
  confidence: z.number().min(0).max(1).describe("Your own certainty in this grade; recorded for logs ONLY"),
  feedback: z.string().describe("Two or three sentences of honest, specific feedback"),
});
export type GradeOutput = z.infer<typeof GradeOutputSchema>;

// --- Reporter --------------------------------------------------------------
export const ReportTopicSchema = z.object({
  name: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
});

// A single concrete weak point, so the report can lead with what to fix instead of
// burying it in prose. area names the topic/theme, issue is the specific weakness.
export const WeakPointSchema = z.object({
  area: z.string().min(1).describe("The topic or theme this weakness is in"),
  issue: z.string().min(1).describe("The specific weakness, concrete and plain"),
});

export const ReportOutputSchema = z.object({
  verdict: z
    .string()
    .min(1)
    .describe(
      "One or two blunt, plain sentences: the overall level reached and the single biggest thing holding them back. No jargon.",
    ),
  summary: z
    .string()
    .describe("A short, plain, honest overview of the self-assessment result. Everyday words, no filler."),
  weakPoints: z
    .array(WeakPointSchema)
    .describe("The main weak points, most important first, so the gaps are obvious at a glance"),
  perTopic: z.array(ReportTopicSchema),
  learningPath: z.array(z.string()).describe("Ordered, concrete next steps to improve, hardest gaps first"),
});
export type ReportOutput = z.infer<typeof ReportOutputSchema>;

// --- Interview question writer (text mode) ----------------------------------
// The writer never chooses the level or the intent; code decides both and hands
// them in. It returns no number at all, so nothing it says can move a score.
export const InterviewQuestionOutputSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe("ONE question, in the requested language. Never two questions joined together."),
  rubricPoints: z
    .array(z.string().min(1))
    .min(2)
    .max(6)
    .describe("What a strong answer AT THIS LEVEL covers. Specific to this question, not generic."),
  gold: z
    .string()
    .min(1)
    .describe("A concise reference answer covering the rubric, written as a competent practitioner would"),
  affords: z
    .array(z.enum(AFFORDANCES))
    .describe(
      "Which of the allowed list the question you actually wrote gives the candidate room to show. Only list what your question genuinely invites; the list you were given is the maximum, never add to it.",
    ),
});
export type InterviewQuestionOutput = z.infer<typeof InterviewQuestionOutputSchema>;

// --- Answer scanner (text mode) ---------------------------------------------
// The scanner reports OBSERVATIONS, never a level, a score, or any number. Code
// maps observations onto a band (core/signals.ts). Splitting the read across
// three calls is deliberate: judging many criteria inside one conversation drags
// them all toward the first impression, and separate calls measurably match human
// distributions better. Three rather than one per criterion because every call
// spawns its own CLI child here, and twenty concurrent children is not a trade
// worth making on a single local machine.

// The two lenses the signal scans are split along. Core owns the vocabulary; the
// agent layer decides how the reading is divided across calls.
export const BUILD_SCAN_CODES = [...MECHANISM_SIGNALS, ...COVERAGE_SIGNALS] as const;
export const JUDGMENT_SCAN_CODES = [
  ...CONDITIONALITY_SIGNALS,
  ...FAILURE_SIGNALS,
  ...CONCRETENESS_SIGNALS,
  ...CALIBRATION_SIGNALS,
  ...ANTI_SIGNALS,
] as const;

const observation = <T extends readonly [string, ...string[]]>(codes: T) =>
  z.object({
    code: z.enum(codes).describe("The signal you observed"),
    quote: z
      .string()
      .min(1)
      .describe(
        "The exact words from the answer that show it, copied character for character. An observation whose quote is not found in the answer is discarded.",
      ),
  });

export const BuildScanOutputSchema = z.object({
  structure: z
    .enum(STRUCTURE_LEVELS)
    .describe("The single shape that best shows how this answer is built"),
  structureEvidence: z
    .string()
    .min(1)
    .describe("One sentence saying why that shape, referring to what the answer does"),
  signals: z
    .array(observation(BUILD_SCAN_CODES))
    .describe("Only signals you actually see, each with its exact quote. An empty list is a valid answer."),
});
export type BuildScanOutput = z.infer<typeof BuildScanOutputSchema>;

export const JudgmentScanOutputSchema = z.object({
  signals: z
    .array(observation(JUDGMENT_SCAN_CODES))
    .describe("Only signals you actually see, each with its exact quote. An empty list is a valid answer."),
});
export type JudgmentScanOutput = z.infer<typeof JudgmentScanOutputSchema>;

export const CoverageScanOutputSchema = z.object({
  matched: z
    .array(
      z.object({
        point: z.string().min(1).describe("The rubric point, copied from the rubric"),
        quote: z.string().min(1).describe("The exact words from the answer that cover it"),
      }),
    )
    .describe("Rubric points the answer genuinely covers"),
  missing: z.array(z.string()).describe("Rubric points the answer does not cover"),
  misconceptions: z
    .array(
      z.object({
        claim: z.string().min(1).describe("The wrong statement, quoted from the answer"),
        correction: z.string().min(1).describe("What is actually true, in one plain sentence"),
      }),
    )
    .describe("Statements that are confidently wrong, not merely incomplete"),
  feedback: z
    .string()
    .describe("Two or three sentences of honest, specific feedback on this answer"),
});
export type CoverageScanOutput = z.infer<typeof CoverageScanOutputSchema>;

// --- MCQ (hybrid mode) ------------------------------------------------------
// One multiple-choice question. correctIndex bounds are re-checked in code when
// the question is stored (a refine is intentionally avoided so z.toJSONSchema
// stays a plain object schema for the CLI validator).
export const McqSchema = z.object({
  level: z.number().int().min(1).max(10).describe("The level 1-10 this MCQ targets"),
  stem: z.string().min(1).describe("The question text: one clear question"),
  options: z
    .array(z.string().min(1))
    .min(3)
    .max(5)
    .describe("Answer options; EXACTLY ONE is correct, the rest are plausible distractors"),
  correctIndex: z
    .number()
    .int()
    .min(0)
    .describe("0-based index of the correct option within options"),
});
export type Mcq = z.infer<typeof McqSchema>;

export const BankTopicSchema = z.object({
  name: z.string().min(1).describe("The topic name, matching a requested topic"),
  questions: z.array(McqSchema).min(1).max(8).describe("MCQs for this topic across the requested levels"),
});
export const BankBuilderOutputSchema = z.object({
  topics: z.array(BankTopicSchema).min(1).max(8),
});
export type BankBuilderOutput = z.infer<typeof BankBuilderOutputSchema>;
