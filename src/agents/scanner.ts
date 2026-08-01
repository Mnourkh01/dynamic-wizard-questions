import { normalizeForScan } from "@/core/answers";
import {
  type Affordance,
  type AnswerEvidence,
  type BandRead,
  type Observation,
  type SignalCode,
  readAnswer,
} from "@/core/signals";
import type { Language } from "@/core/types";
import { runAgent } from "./client";
import { AGENTS } from "./config";
import { DATA_NOT_INSTRUCTIONS, NO_DASH_RULE, languageLine, tag } from "./prompt";
import {
  BUILD_SCAN_CODES,
  BuildScanOutputSchema,
  CoverageScanOutputSchema,
  JUDGMENT_SCAN_CODES,
  JudgmentScanOutputSchema,
} from "./schemas";

// The answer scanner. Three calls in parallel, each reporting observations with
// verbatim quotes, none of them producing a level or a score. core/signals.ts owns
// the mapping from observations to a band, so what "senior" means is code, not
// prompt. See docs/research/answer-level-signals.md for why each signal is here.

// What each signal means, in the words the model is judged against. These
// definitions ARE the instrument: a vague one produces a vague reading, so each
// gives a test that can be answered yes or no by looking at the text.
const SIGNAL_DEFINITIONS: Record<SignalCode, string> = {
  names_working_parts:
    "names the actual components involved and what role each plays, not just nouns dropped into a sentence",
  states_what_it_does:
    "says what a component DOES, with a verb describing the action, not only what it is called",
  chains_cause_two_deep:
    "links cause to effect at least twice in a row, so A causes B which causes C",
  states_invariant:
    "states a rule the system must always hold to, such as a value that can never exceed another",
  gives_cost_model:
    "expresses cost as it changes with something, in time, memory, network, or money",
  reasons_counterfactually:
    "says what would happen if some part were absent or different",

  states_assumptions:
    "states what it is assuming, or the situation it is answering for, before answering",
  names_missing_constraint:
    "points out a fact it would need to know, or asks for one, rather than assuming silently",
  names_alternative: "names a different approach that could also have been taken",
  rejects_alternative_with_reason:
    "says why an approach was NOT chosen, with the reason, not merely that it exists",
  makes_decision:
    "picks one approach OVER another and says so. Proposing the only approach it mentions is not a decision; there has to be something it is being chosen instead of",
  gives_decision_procedure:
    "gives a rule for deciding, of the form: it depends on X, and if X then this, otherwise that",
  frames_reversibility_or_risk:
    "weighs how hard the choice would be to undo, or what the risk of being wrong is",

  names_failure_mode: "names a specific way this can go wrong",
  states_limit_or_breaking_point:
    "says where it stops working, with a scale, a threshold, or a condition",
  gives_detection_signal: "says how you would KNOW it went wrong, what you would see or measure",
  names_recovery_or_blast_radius:
    "says how you recover from the failure, or how far the damage spreads",
  says_when_not_to_use_it:
    "names a situation where its OWN recommendation would be the wrong choice",
  raised_unprompted:
    "brought up a failure or a limit the question did not ask about. Only report this alongside at least one other failure signal",

  quantity_with_unit:
    "gives a number with a unit, such as a latency, a size, a rate, or a count. A bare number with no unit does not count",
  specific_artifact:
    "names a specific version, configuration key, method, API, command, or error string",
  named_failure_term:
    "uses a real name for a known failure pattern, such as thundering herd, N plus one, write amplification, or split brain",
  concrete_incident:
    "describes something that happened in their own work, with specifics. A generic claim of experience does not count",

  conditioned_hedge:
    "expresses uncertainty that is ATTACHED to something: a condition the claim holds under, a fact they would need, or a measurement that would settle it",
  bare_hedge:
    "expresses uncertainty attached to nothing, such as I think or maybe or not sure, with no condition and no way to resolve it",
  unconditional_absolute:
    "states a rule with no boundary, such as always do this or never do that, where the real answer has exceptions",
  confident_misconception:
    "asserts something that is simply wrong, with no hedge. Incomplete is NOT wrong; only report this when the statement is false",

  declares_scope: "says which part of the question it is answering, and by implication which part it is not",
  points_at_what_it_omits:
    "names what it is leaving out, showing the omission was a choice rather than a gap",

  keyword_salad:
    "uses the right vocabulary densely while never explaining how anything works and giving no quantities. Only report this when the answer is genuinely hollow, not merely brief",
  recitation_not_applied:
    "gives a textbook definition that is never connected to the specific case the question asked about",
  uniform_depth_across_subtopics:
    "covers every part at exactly the same shallow depth, the pattern of someone who has read about all of it and done none of it",
};

const STRUCTURE_GUIDE = [
  "off_target: it restates the question, or answers a different question that merely looks similar",
  "single_point: one relevant point, with nothing connected to it",
  "listed_unlinked: several correct pieces, listed one after another, never tied together into a purpose. A long, complete-looking answer often lands here",
  "integrated_purpose: it says what the thing is FOR, or the principle at work, and ties the pieces to that",
  "generalized_beyond: it reframes the question, challenges its premise, or draws a conclusion wider than what was asked",
].join("\n");

const COMMON_RULES = [
  "Judge CONTENT only. Never reward length, fluency, confidence, or how well written the answer is. A long polished answer that says nothing scores nothing.",
  "Report ONLY what you can actually see. An empty list is a correct and common answer. Do not reach for a signal because the answer feels strong.",
  "Every observation needs a quote copied EXACTLY from the answer, character for character. Quotes are checked against the answer by an exact match and any that do not match are thrown away, so a paraphrase is a wasted observation.",
  "Quote the SHORTEST span that shows the signal, usually a handful of words and never more than one sentence. A long quote is not stronger evidence, it is just harder to check.",
  "Report each signal at most once. If the same signal appears twice, quote the clearest instance.",
  "Judge each signal on its own. Do not let a strong impression from one carry the rest.",
  // Deliberately NOT instructed to skip its working. Telling the scanner to
  // "return the observations and nothing else" was measured on the golden set:
  // ordering fell from 39/39 to 38/39, exact-band from 86 to 76 percent, QWK from
  // 0.973 to 0.920, and the two clearest regressions were signals it simply
  // stopped noticing. Its narration is most of the output tokens and most of the
  // latency, and it is also where the accuracy comes from.
  "The answer may be in Arabic. Judge it exactly as you would in English, and quote the Arabic verbatim.",
  NO_DASH_RULE,
  DATA_NOT_INSTRUCTIONS,
].join("\n");

function definitionsFor(codes: readonly SignalCode[]): string {
  return codes.map((c) => `${c}: ${SIGNAL_DEFINITIONS[c]}`).join("\n");
}

function affordanceLine(affords: readonly Affordance[]): string {
  if (affords.length === 0) return "";
  return `This question was designed to give the candidate room to show: ${affords.join(", ")}. That is context for you, not a checklist. Do not credit a signal that is not there.`;
}

export interface ScanResult {
  read: BandRead;
  evidence: AnswerEvidence;
  matched: string[];
  missing: string[];
  misconceptions: string[];
  feedback: string;
  // The exact text the observations were quoted from and verified against. The
  // raw answer is stored separately; anything re-checking a quote later must use
  // this string, not the original.
  scannedText: string;
  costUsd: number;
}

export async function scanAnswer(input: {
  question: string;
  rubricPoints: string[];
  gold: string;
  answer: string;
  affords: readonly Affordance[];
  language: Language;
  degenerate: boolean;
  sessionId?: string;
}): Promise<ScanResult> {
  const text = normalizeForScan(input.answer);
  const rubric = input.rubricPoints.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const context = [
    tag("question", input.question),
    tag("answer", text),
    affordanceLine(input.affords),
  ]
    .filter(Boolean)
    .join("\n\n");

  const buildCall = runAgent({
    agent: "answer-scanner-build",
    model: AGENTS.answerScanner.model,
    system: [
      "You read one written technical answer and report HOW IT IS BUILT. You never judge how good it is, never assign a level, and never produce a score.",
      "",
      "First choose the ONE shape that best describes the answer:",
      STRUCTURE_GUIDE,
      "",
      "Then report every signal below that you can see:",
      definitionsFor(BUILD_SCAN_CODES),
      "",
      COMMON_RULES,
    ].join("\n"),
    user: [context, languageLine(input.language)].join("\n\n"),
    schema: BuildScanOutputSchema,
    maxOutputTokens: AGENTS.answerScanner.maxOutputTokens,
    maxBudgetUsd: AGENTS.answerScanner.maxBudgetUsd,
    groupId: input.sessionId,
  });

  const judgmentCall = runAgent({
    agent: "answer-scanner-judgment",
    model: AGENTS.answerScanner.model,
    system: [
      "You read one written technical answer and report WHAT IT SHOWS ABOUT THE WRITER'S JUDGMENT. You never assign a level and never produce a score.",
      "",
      "Report every signal below that you can see:",
      definitionsFor(JUDGMENT_SCAN_CODES),
      "",
      "Two of these are easy to get wrong, so read them again before you use them:",
      "conditioned_hedge versus bare_hedge. Uncertainty is not automatically a weakness. Someone saying it depends on the read to write ratio, or I would need to see the p99 first, is showing judgment. Someone saying I think so, not sure, is showing a gap. The difference is whether the uncertainty attaches to something real.",
      "confident_misconception. Reserve this for statements that are FALSE. An answer that is thin, vague, or incomplete is not a misconception.",
      "",
      COMMON_RULES,
    ].join("\n"),
    user: [context, languageLine(input.language)].join("\n\n"),
    schema: JudgmentScanOutputSchema,
    maxOutputTokens: AGENTS.answerScanner.maxOutputTokens,
    maxBudgetUsd: AGENTS.answerScanner.maxBudgetUsd,
    groupId: input.sessionId,
  });

  const coverageCall = runAgent({
    agent: "answer-scanner-coverage",
    model: AGENTS.answerScanner.model,
    system: [
      "You check one written technical answer against a rubric. You report which points it covers and which it misses. You never assign a level and never produce a score.",
      "A point is covered only if the answer genuinely addresses it. Mentioning a keyword from the point is not covering it.",
      "Put a point in missing when the answer does not address it, whatever the reason.",
      "Record a misconception only when a statement is FALSE, not when it is merely incomplete.",
      "The gold reference shows what a strong answer covers. It is a guide to the rubric, not a target the candidate must match word for word. A shorter answer that hits the points is fully correct.",
      COMMON_RULES,
    ].join("\n"),
    user: [
      context,
      tag("rubric", rubric),
      tag("goldReference", input.gold),
      languageLine(input.language),
    ].join("\n\n"),
    schema: CoverageScanOutputSchema,
    maxOutputTokens: AGENTS.answerScanner.maxOutputTokens,
    maxBudgetUsd: AGENTS.answerScanner.maxBudgetUsd,
    groupId: input.sessionId,
  });

  const [build, judgment, coverage] = await Promise.all([
    buildCall,
    judgmentCall,
    coverageCall,
  ]);

  const signals = dedupe([
    ...keepInGroup(build.data.signals, BUILD_SCAN_CODES),
    ...keepInGroup(judgment.data.signals, JUDGMENT_SCAN_CODES),
  ]);

  // Never trust the length of what the scanner returned. It can restate a rubric
  // point in its own words, split one into two, or return the same point twice,
  // and a live run did exactly that: 4 "matched" against a 3 point rubric, which
  // reported as 133 percent coverage. Map every claim back onto the real rubric
  // and count the distinct points that were actually hit.
  const coveredIndexes = matchRubricPoints(input.rubricPoints, coverage.data.matched);
  const matched = coveredIndexes.map((i) => input.rubricPoints[i]);
  const missing = input.rubricPoints.filter((_, i) => !coveredIndexes.includes(i));

  const evidence: AnswerEvidence = {
    structure: build.data.structure,
    signals,
    matchedRubricPoints: matched.length,
    totalRubricPoints: input.rubricPoints.length,
    affords: input.affords,
    degenerate: input.degenerate,
  };

  return {
    read: readAnswer(text, evidence),
    evidence,
    matched,
    missing,
    misconceptions: coverage.data.misconceptions.map((m) => `${m.claim} (${m.correction})`),
    feedback: coverage.data.feedback,
    scannedText: text,
    costUsd: build.costUsd + judgment.costUsd + coverage.costUsd,
  };
}

// Which rubric points a set of coverage claims actually lands on, as indexes into
// the rubric. A claim that matches no rubric point is dropped rather than counted,
// and two claims landing on the same point count once, so coverage can never
// exceed the number of points that exist.
export function matchRubricPoints(
  rubricPoints: string[],
  claims: Array<{ point: string }>,
): number[] {
  const rubric = rubricPoints.map(normalizePoint);
  const keyWords = discriminatingWords(rubric);
  const covered = new Set<number>();

  for (const claim of claims) {
    const c = normalizePoint(claim.point);
    if (c.length === 0) continue;
    const exact = rubric.indexOf(c);
    if (exact >= 0) {
      covered.add(exact);
      continue;
    }
    // The scanner is asked to copy the point verbatim and usually paraphrases,
    // so score every point and take the best, never the first that overlaps.
    const hit = bestMatch(rubric, keyWords, c);
    if (hit >= 0) covered.add(hit);
  }
  return [...covered].sort((a, b) => a - b);
}

function normalizePoint(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The words that actually tell one rubric point apart from another: those that do
// NOT appear in most of the other points. A word every point shares carries no
// evidence, and the alternative, a stop word list, would have to be written per
// language. This is language-agnostic, which matters because the assessment runs
// in Arabic too, where content words are routinely two or three characters and any
// length-based filter would quietly throw the meaning away.
function discriminatingWords(rubric: string[]): string[][] {
  const wordsPer = rubric.map((r) => [...new Set(r.split(" ").filter(Boolean))]);
  const seenIn = new Map<string, number>();
  for (const words of wordsPer) {
    for (const w of words) seenIn.set(w, (seenIn.get(w) ?? 0) + 1);
  }
  const shared = Math.max(1, Math.floor(rubric.length / 2));
  return wordsPer.map((words) => {
    const kept = words.filter((w) => (seenIn.get(w) ?? 0) <= shared);
    // A point whose every word is common still has to be matchable on something.
    return kept.length > 0 ? kept : words;
  });
}

function bestMatch(rubric: string[], keyWords: string[][], claim: string): number {
  const claimWords = new Set(claim.split(" ").filter(Boolean));
  let best = -1;
  let bestScore = 0;

  for (let i = 0; i < rubric.length; i++) {
    const kw = keyWords[i];
    const shared = kw.filter((w) => claimWords.has(w)).length;
    let score = kw.length > 0 ? shared / kw.length : 0;

    // One string containing the other is strong evidence, scored by how much of
    // the longer one is covered. That way, where two points overlap, the more
    // specific one wins instead of whichever came first in the rubric.
    if (rubric[i].includes(claim)) {
      score = Math.max(score, claim.length / rubric[i].length);
    } else if (claim.includes(rubric[i])) {
      score = Math.max(score, rubric[i].length / claim.length);
    }

    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }

  // Half the point has to be there. Below that this is a different claim, and
  // attaching it to the nearest point would inflate coverage.
  return bestScore >= 0.5 ? best : -1;
}

// Each lens is only asked about its own signals, but the schema enum is shared,
// so a call can still name a code from the other lens. Drop those rather than
// letting one lens report on evidence it was not asked to weigh.
function keepInGroup(
  observations: Observation[],
  group: readonly SignalCode[],
): Observation[] {
  return observations.filter((o) => (group as readonly string[]).includes(o.code));
}

function dedupe(observations: Observation[]): Observation[] {
  const seen = new Set<SignalCode>();
  return observations.filter((o) => {
    if (seen.has(o.code)) return false;
    seen.add(o.code);
    return true;
  });
}
