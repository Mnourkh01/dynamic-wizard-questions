import { DISCOVERY_LEVEL, THETA_MAX, THETA_MIN } from "./constants";
import { clamp, clampLevel } from "./ladder";
import { rngFromKey } from "./shuffle";
import type { Affordance, Axis } from "./signals";

// What the next question is FOR. Code picks the intent, an agent writes the
// words. That split is what makes the interview both adaptive and reproducible:
// the same session state always chooses the same intent, so a resumed or replayed
// session asks the same kind of question, while the wording stays alive.
//
// The intents come from the level-discriminating behaviours in
// docs/research/answer-level-signals.md. Each one exists to make a specific
// signal possible to show, which is why every intent carries its affordances.

export type QuestionIntent =
  | "wide_opener"
  | "own_words_probe"
  | "tradeoff_fork"
  | "failure_and_recovery"
  | "constrained_scenario"
  | "experience_anchor"
  | "premise_challenge"
  | "floor_check";

// What a question of this kind can legitimately ask the candidate to show. This
// is the ONLY source of affordances: the writing agent may narrow this set to
// match the question it actually wrote, never widen it. Self-declared
// affordances would let the writer silently cap a fair answer (by claiming a
// question invited a trade-off it did not) or silently remove every cap.
export const INTENT_AFFORDANCES: Record<QuestionIntent, readonly Affordance[]> = {
  wide_opener: ["mechanism", "conditionality", "failure", "quantity", "experience"],
  own_words_probe: ["mechanism", "conditionality", "failure"],
  tradeoff_fork: ["mechanism", "conditionality", "quantity"],
  failure_and_recovery: ["mechanism", "failure", "quantity"],
  constrained_scenario: ["mechanism", "conditionality", "failure", "quantity"],
  experience_anchor: ["experience", "failure", "quantity"],
  premise_challenge: ["mechanism", "conditionality", "failure"],
  floor_check: ["mechanism"],
};

// A one-line brief handed to the question writer. Deliberately about the SHAPE of
// the question, never its content: the topic and the level supply the content.
export const INTENT_BRIEFS: Record<QuestionIntent, string> = {
  wide_opener:
    "An open question about the topic that anyone in the field can start answering, and that a strong practitioner can take much further. It must not be a trick and must not be multi-part.",
  own_words_probe:
    "Quote a specific phrase from the candidate's own previous answer and ask them to go one level deeper on exactly that. This is the highest-value question type: it follows their thinking instead of changing the subject.",
  tradeoff_fork:
    "Present two genuinely viable approaches to a concrete situation and ask which one they would pick and why. The question must make clear that choosing is the point.",
  failure_and_recovery:
    "Ask what goes wrong with a specific approach in production: how it breaks, how they would notice, and what they would do about it.",
  constrained_scenario:
    "Give a short realistic scenario with a constraint or two, leave some detail deliberately unstated, and ask how they would approach it.",
  experience_anchor:
    "Ask about a time in their own work when something in this area broke or surprised them, and what they changed as a result.",
  premise_challenge:
    "State a plausible but over-general claim about the topic as if it were settled, and ask whether they agree. A strong answer pushes back and names the conditions; a weak one agrees.",
  floor_check:
    "A clearly simpler, foundational question on the topic, to tell 'does not know this area' apart from 'had one bad answer'.",
};

// The axis each intent is best at drawing out, used to close evidence gaps.
// structure and coverage are read from EVERY answer, so no intent targets them.
const CLOSES_AXIS: Partial<Record<Axis, QuestionIntent>> = {
  conditionality: "tradeoff_fork",
  failureAwareness: "failure_and_recovery",
  concreteness: "experience_anchor",
  mechanism: "own_words_probe",
  calibration: "premise_challenge",
};

// The first three questions follow a fixed ladder instead of chasing the
// estimate. Information-based selection is unstable while the estimate is still
// mostly prior, and an interview that lurches in the first three questions reads
// as broken even when the maths is sound.
const OPENING_LADDER: QuestionIntent[] = [
  "wide_opener",
  "own_words_probe",
  "tradeoff_fork",
];

export interface IntentChoice {
  intent: QuestionIntent;
  targetLevel: number;
  affords: readonly Affordance[];
  brief: string;
  // Whether the writer needs the candidate's previous answer to build the
  // question. Only own_words_probe does, and only when there is one to quote.
  quotesPreviousAnswer: boolean;
}

export interface IntentInput {
  sessionId: string;
  order: number; // 1-based position of the question being chosen
  theta: number; // running ability for the topic about to be asked
  unobserved: Axis[];
  consecutiveWeak: number;
  hasPreviousAnswer: boolean;
}

export function chooseIntent(input: IntentInput): IntentChoice {
  return build(pick(input), input.theta);
}

function pick(input: IntentInput): QuestionIntent {
  if (input.order <= OPENING_LADDER.length) {
    const opening = OPENING_LADDER[input.order - 1];
    // The probe needs something to quote. On the very first topic of a resumed
    // or oddly-ordered session there may be nothing, so fall through.
    if (opening === "own_words_probe" && !input.hasPreviousAnswer) return "tradeoff_fork";
    return opening;
  }

  // Two weak answers in a row is ambiguous: it can mean the topic is genuinely
  // above them, or that one answer went badly and the next question was aimed at
  // an estimate that had not caught up. An easier question separates the two, and
  // it is also the humane thing to do partway through a hard interview.
  if (input.consecutiveWeak >= 2) return "floor_check";

  const gaps = input.unobserved
    .map((axis) => CLOSES_AXIS[axis])
    .filter((i): i is QuestionIntent => i !== undefined)
    .filter((i) => i !== "own_words_probe" || input.hasPreviousAnswer);

  if (gaps.length > 0) return chooseAmong(gaps, input);

  // Nothing missing. At senior level and above, the remaining question worth
  // asking is whether they hold up under an over-general claim or an ambiguous
  // brief; below that, following their own words goes deeper than a new topic.
  const strong: QuestionIntent[] =
    input.theta >= 7
      ? ["premise_challenge", "constrained_scenario"]
      : input.hasPreviousAnswer
        ? ["own_words_probe", "constrained_scenario"]
        : ["constrained_scenario", "failure_and_recovery"];
  return chooseAmong(strong, input);
}

// Randomesque selection: pick among the tied candidates rather than always the
// first. Greedy argmax selection is known to over-use a narrow slice of the
// available questions, which here would mean every session feeling identical.
// Seeded on the session and the position so a replayed or resumed session makes
// exactly the same choice, the same rule the option shuffle already follows.
function chooseAmong(candidates: QuestionIntent[], input: IntentInput): QuestionIntent {
  if (candidates.length === 1) return candidates[0];
  const rand = rngFromKey(`${input.sessionId}:intent:${input.order}`);
  return candidates[Math.floor(rand() * candidates.length)];
}

function build(intent: QuestionIntent, theta: number): IntentChoice {
  return {
    intent,
    targetLevel: targetLevelFor(intent, theta),
    affords: INTENT_AFFORDANCES[intent],
    brief: INTENT_BRIEFS[intent],
    quotesPreviousAnswer: intent === "own_words_probe",
  };
}

function targetLevelFor(intent: QuestionIntent, theta: number): number {
  if (intent === "wide_opener") return DISCOVERY_LEVEL;
  // A floor check is only useful if it is genuinely easier than what just went
  // wrong; one step down lands too close to the question they already missed.
  if (intent === "floor_check") return clamp(clampLevel(theta) - 2, THETA_MIN, THETA_MAX);
  // These two are the ceiling probes of the written format: they ask for more
  // than the current estimate to find out whether the estimate is the ceiling.
  if (intent === "premise_challenge" || intent === "constrained_scenario") {
    return clamp(clampLevel(theta) + 1, THETA_MIN, THETA_MAX);
  }
  return clampLevel(theta);
}

// Narrow the intent's affordances to what the question as written can actually
// elicit. The writer may drop affordances, never add them, so a writer that
// misreports cannot inflate what the candidate is held to.
export function narrowAffordances(
  intent: QuestionIntent,
  declared: readonly string[],
): readonly Affordance[] {
  const allowed = INTENT_AFFORDANCES[intent];
  const kept = allowed.filter((a) => declared.includes(a));
  // A writer that declares nothing usable keeps the intent's own set rather than
  // an empty one, which would silently disable every cap for that question.
  return kept.length > 0 ? kept : allowed;
}
