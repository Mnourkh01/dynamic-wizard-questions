import { z } from "zod";

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
