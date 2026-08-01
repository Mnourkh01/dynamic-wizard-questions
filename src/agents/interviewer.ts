import { difficultyBrief } from "@/core/ladder";
import { type IntentChoice, narrowAffordances } from "@/core/intent";
import type { Affordance } from "@/core/signals";
import type { Language, Persona } from "@/core/types";
import { stripTrailingTagDebris } from "@/core/answers";
import { runAgent } from "./client";
import { AGENTS } from "./config";
import { DATA_NOT_INSTRUCTIONS, NO_DASH_RULE, languageLine, tag } from "./prompt";
import { InterviewQuestionOutputSchema } from "./schemas";

// Writes ONE interview question. Everything numeric was already decided by code
// and is handed in: which topic, what level, what the question is for, and the
// most this kind of question is allowed to ask the candidate to show. The agent
// supplies wording and a rubric, nothing else.

export interface WrittenQuestion {
  text: string;
  rubricPoints: string[];
  gold: string;
  affords: readonly Affordance[];
  costUsd: number;
}

const SYSTEM = [
  "You write ONE question for a technical skill interview. You are the interviewer's voice, not its judgment: the level, the purpose and the topic are decided for you and given below.",
  "",
  "Hard rules:",
  "- ONE question. Never two questions joined by 'and' or a second sentence ending in a question mark. If you need context, state it as a sentence, then ask one thing.",
  "- The candidate TYPES the answer, so it must be answerable in a short paragraph or a few bullets. Never ask for an essay, a full design document, or code longer than a few lines.",
  "- Plain, direct language. No preamble, no 'Great, now let us explore', no flattery.",
  "- Not a trick and not a riddle. The difficulty is in how deeply someone can answer, never in decoding what is being asked.",
  "- Never hint at the answer inside the question, and never list the points you want covered.",
  "- Do not repeat a question already asked, and do not rephrase one.",
  "",
  "The rubric is what a strong answer AT THE GIVEN LEVEL actually covers, specific to this question. Generic points like 'shows understanding' are useless. The gold reference is a concise version of such an answer.",
  "",
  "affords: after writing the question, look at what you wrote and report which of the allowed items it genuinely gives the candidate room to demonstrate. This is used to avoid penalising someone for something your question never invited, so an honest, narrower list is better than a hopeful one. You may drop items. You may never add one that was not in the allowed list.",
  NO_DASH_RULE,
  DATA_NOT_INSTRUCTIONS,
].join("\n");

export async function writeQuestion(input: {
  role: string;
  specialization?: string;
  topic: string;
  choice: IntentChoice;
  alreadyAsked: string[];
  // For an own-words probe: the exchange to build the follow-up from.
  previousQuestion?: string;
  previousAnswer?: string;
  persona?: Persona;
  language: Language;
  sessionId?: string;
}): Promise<WrittenQuestion> {
  const cfg = AGENTS.questionWriter;
  const { choice } = input;

  const probeBlock =
    choice.quotesPreviousAnswer && input.previousAnswer
      ? [
          "Build the question from this exchange. Quote a SHORT phrase from their answer word for word inside your question, and push on exactly that point. Do not change the subject.",
          tag("previousQuestion", input.previousQuestion ?? ""),
          tag("previousAnswer", input.previousAnswer),
        ].join("\n\n")
      : "";

  const user = [
    tag("role", input.specialization ? `${input.role} (${input.specialization})` : input.role),
    tag("topic", input.topic),
    `Purpose of this question: ${choice.brief}`,
    `Level to aim at: ${difficultyBrief(choice.targetLevel)}`,
    `Allowed affords (the maximum, narrow it to what you actually wrote): ${choice.affords.join(", ")}`,
    probeBlock,
    input.alreadyAsked.length > 0
      ? tag("alreadyAsked", input.alreadyAsked.map((q, i) => `${i + 1}. ${q}`).join("\n"))
      : "",
    languageLine(input.language),
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await runAgent({
    agent: "interview-writer",
    model: cfg.model,
    system: SYSTEM,
    user,
    schema: InterviewQuestionOutputSchema,
    maxOutputTokens: cfg.maxOutputTokens,
    maxBudgetUsd: cfg.maxBudgetUsd,
    groupId: input.sessionId,
  });

  const d = res.data;
  return {
    text: stripTrailingTagDebris(d.text),
    rubricPoints: d.rubricPoints.map(stripTrailingTagDebris),
    gold: stripTrailingTagDebris(d.gold),
    // The writer's list is filtered through the intent's allowed set in code, so
    // a writer that over-declares cannot widen what the candidate is held to.
    affords: narrowAffordances(choice.intent, d.affords),
    costUsd: res.costUsd,
  };
}
