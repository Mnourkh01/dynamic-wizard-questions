import { z } from "zod";

// Zod output contracts for every agent. These are the single source of truth for
// what each agent must return; runAgent converts them to JSON schema for the CLI
// and re-validates the response, so agent results are always typed, bounded data.

// --- Blueprint -------------------------------------------------------------
export const BlueprintTopicSchema = z.object({
  name: z.string().min(1).describe("A specific, non-overlapping skill area for this role"),
  weight: z
    .number()
    .int()
    .min(1)
    .describe("Relative importance as a positive integer; code normalizes these to sum 1000"),
  prior: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("Level 1-10 a person matching the persona would typically start at; aims the first question only"),
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

export const ReportOutputSchema = z.object({
  summary: z.string().describe("A short honest overview of the self-assessment result"),
  perTopic: z.array(ReportTopicSchema),
  learningPath: z.array(z.string()).describe("Ordered, concrete next steps to improve"),
});
export type ReportOutput = z.infer<typeof ReportOutputSchema>;
