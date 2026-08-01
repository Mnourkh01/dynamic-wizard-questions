// The measurement instrument. Pure, no I/O, no agents.
//
// The scanning agent NEVER decides a level. It reports binary observations about
// one answer, each carrying a verbatim quote. This file turns those observations
// into a band, deterministically, so the product's opinion about what "senior"
// means lives in reviewable, testable code instead of inside a prompt.
//
// Every rule below traces to docs/research/answer-level-signals.md. The short
// version of the evidence: term density, length and fluency are near-worthless
// (answer length correlates 0.61 to 0.80 with human essay scores, which is why it
// is excluded here); what actually separates levels is how the answer is built,
// whether it conditionalizes its advice, whether it knows what breaks, and whether
// its uncertainty is calibrated.

// --- The scale --------------------------------------------------------------

export const BAND_MIN = 1;
export const BAND_MAX = 6;

export const BAND_NAMES: Record<number, string> = {
  1: "novice",
  2: "beginner",
  3: "competent",
  4: "proficient",
  5: "expert",
  6: "principal",
};

// A band is a read of ONE answer. The engine's running ability estimate stays on
// the existing 1..10 scale (DB, scoring, report all speak it), so a band read is
// converted to the level at the middle of that band's range.
const BAND_TO_LEVEL = [1.5, 3.5, 5.5, 7.5, 9, 10];

export function bandToLevel(band: number): number {
  const i = clampBand(band) - 1;
  return BAND_TO_LEVEL[i];
}

export function bandName(band: number): string {
  return BAND_NAMES[clampBand(band)] ?? "novice";
}

function clampBand(band: number): number {
  if (!Number.isFinite(band)) return BAND_MIN;
  return Math.max(BAND_MIN, Math.min(BAND_MAX, Math.round(band)));
}

// --- What the scanner is allowed to report ----------------------------------

// Structure is single-valued: an answer has ONE shape. The ladder is Biggs and
// Collis (SOLO), which Lister et al. applied to code explanations: about half of
// students produce "listed_unlinked" (correct pieces, never integrated) while 7 of
// 8 educators produce "integrated_purpose". This is also the honest answer to
// "did they answer half the question": a listed_unlinked answer can be LONGER and
// cover MORE ground than an integrated one and still be a lower band.
export const STRUCTURE_LEVELS = [
  "off_target", // restates the question, or answers a different, surface-similar one
  "single_point", // one relevant point, nothing connected to it
  "listed_unlinked", // several correct pieces, listed, never integrated
  "integrated_purpose", // states the purpose or governing principle and ties the pieces to it
  "generalized_beyond", // reframes the question, challenges its premise, or generalizes past it
] as const;
export type StructureLevel = (typeof STRUCTURE_LEVELS)[number];

export const MECHANISM_SIGNALS = [
  "names_working_parts",
  "states_what_it_does",
  "chains_cause_two_deep",
  "states_invariant",
  "gives_cost_model",
  "reasons_counterfactually",
] as const;

export const CONDITIONALITY_SIGNALS = [
  "states_assumptions",
  "names_missing_constraint",
  "names_alternative",
  "rejects_alternative_with_reason",
  "makes_decision",
  "gives_decision_procedure",
  "frames_reversibility_or_risk",
] as const;

export const FAILURE_SIGNALS = [
  "names_failure_mode",
  "states_limit_or_breaking_point",
  "gives_detection_signal",
  "names_recovery_or_blast_radius",
  "says_when_not_to_use_it",
  "raised_unprompted",
] as const;

export const CONCRETENESS_SIGNALS = [
  "quantity_with_unit",
  "specific_artifact", // a version, config key, API or method name, error string
  "named_failure_term", // thundering herd, N+1, write amplification, split brain
  "concrete_incident", // a first-person incident with specifics, not a generic claim
] as const;

// Hedging is an EXPERT signal when it is conditioned and a novice signal when it
// is bare. Hyland measured 20.9 hedges per 1,000 words in expert scientific prose,
// peaking at 36.4 in Discussion sections, and the expert ones reference limiting
// conditions, a method, or an explicit gap. So the ratio matters, never the count.
export const CALIBRATION_SIGNALS = [
  "conditioned_hedge", // scopes the claim, names the missing evidence, or names a measurement
  "bare_hedge", // "I think", "maybe", attached to memory with no condition
  "unconditional_absolute", // "always use X" with no boundary
  "confident_misconception", // a wrong claim asserted without a hedge
] as const;

// Coverage signals distinguish OMISSION (does not know) from COMPRESSION (knows,
// chose brevity). Compression leaves residue: a declared scope, or a pointer at
// what is being left out.
export const COVERAGE_SIGNALS = ["declares_scope", "points_at_what_it_omits"] as const;

// Anti-signals CAP a band. They never subtract points, because subtraction lets a
// long answer buy back a cap by padding, which is exactly the length bias we are
// trying to exclude.
export const ANTI_SIGNALS = [
  "keyword_salad", // dense terminology, zero mechanism, zero quantities
  "recitation_not_applied", // textbook definition never applied to the asked instance
  "uniform_depth_across_subtopics", // real practitioners are lumpy, deep where they were burned
] as const;

export const SIGNAL_CODES = [
  ...MECHANISM_SIGNALS,
  ...CONDITIONALITY_SIGNALS,
  ...FAILURE_SIGNALS,
  ...CONCRETENESS_SIGNALS,
  ...CALIBRATION_SIGNALS,
  ...COVERAGE_SIGNALS,
  ...ANTI_SIGNALS,
] as const;
export type SignalCode = (typeof SIGNAL_CODES)[number];

export type Axis =
  | "structure"
  | "mechanism"
  | "conditionality"
  | "failureAwareness"
  | "concreteness"
  | "calibration"
  | "coverage";

export const SIGNALS_BY_AXIS: Record<Exclude<Axis, "structure">, readonly SignalCode[]> = {
  mechanism: MECHANISM_SIGNALS,
  conditionality: CONDITIONALITY_SIGNALS,
  failureAwareness: FAILURE_SIGNALS,
  concreteness: CONCRETENESS_SIGNALS,
  calibration: CALIBRATION_SIGNALS,
  coverage: COVERAGE_SIGNALS,
};

// What a question makes it POSSIBLE to show. A definition question cannot invite a
// trade-off, so an answer to it must never be penalized for lacking one. The
// question writer declares this alongside the question; without it the instrument
// silently punishes candidates for the question writer's choices, which is the most
// common way an assessment reads unfairly.
export const AFFORDANCES = [
  "mechanism",
  "conditionality",
  "failure",
  "quantity",
  "experience",
] as const;
export type Affordance = (typeof AFFORDANCES)[number];

// --- The input the instrument consumes --------------------------------------

export interface Observation {
  code: SignalCode;
  // A verbatim span from the answer. Quotes are checked against the answer text by
  // verifyQuotes BEFORE this reaches readBand; an observation whose quote does not
  // appear in the answer is discarded, which is the defense against a scanner
  // hallucinating credit. Checked with a string match, no model involved.
  quote: string;
}

export interface AnswerEvidence {
  structure: StructureLevel;
  signals: Observation[];
  matchedRubricPoints: number;
  totalRubricPoints: number;
  affords: readonly Affordance[];
  // Set by code (empty, gibberish, too short), never by the scanner.
  degenerate: boolean;
}

export type AxisProfile = Record<Axis, number>; // each 0..1

export interface BandRead {
  band: number; // 1..6
  baseBand: number; // before promotions and caps, from structure alone
  promotions: string[];
  caps: string[];
  axisProfile: AxisProfile;
  demonstratedLevel: number; // 1..10, what the ability engine consumes
}

// --- Quote verification ------------------------------------------------------

// Drop any observation whose quote is not literally present in the answer. The
// comparison is whitespace-insensitive because models reflow line breaks when they
// quote, but it is otherwise exact: no fuzzy matching, no similarity threshold.
// Removing this step measurably costs agreement with human raters, so it is not
// optional politeness, it is part of the measurement.
export function verifyQuotes(answer: string, observations: Observation[]): Observation[] {
  const haystack = collapseWhitespace(answer).toLowerCase();
  return observations.filter((o) => {
    const needle = collapseWhitespace(o.quote).toLowerCase();
    if (needle.length === 0) return false;
    return haystack.includes(needle);
  });
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// --- The mapping -------------------------------------------------------------

const STRUCTURE_BASE: Record<StructureLevel, number> = {
  off_target: 1,
  single_point: 1,
  listed_unlinked: 2,
  integrated_purpose: 3,
  generalized_beyond: 4,
};

const MAX_PROMOTIONS = 2;

// The entry point callers should use. verifyQuotes is not optional, and leaving it
// to the caller means one forgotten line hands a scanner full credit for
// observations it invented. Taking the raw answer here makes the safe path the
// only convenient path. readBand stays exported for tests that construct evidence
// directly.
export function readAnswer(answer: string, evidence: AnswerEvidence): BandRead {
  return readBand({ ...evidence, signals: verifyQuotes(answer, evidence.signals) });
}

export function readBand(evidence: AnswerEvidence): BandRead {
  const has = (code: SignalCode) => evidence.signals.some((s) => s.code === code);
  const countIn = (codes: readonly SignalCode[]) => codes.filter(has).length;
  const profile = axisProfile(evidence);

  if (evidence.degenerate) {
    return {
      band: 1,
      baseBand: 1,
      promotions: [],
      caps: ["no gradable answer"],
      axisProfile: profile,
      demonstratedLevel: bandToLevel(1),
    };
  }

  const baseBand = STRUCTURE_BASE[evidence.structure] ?? 1;

  // Promotions. Each fires at most once and the total is capped, so no single
  // strong habit can carry an otherwise thin answer to the top.
  const promotions: string[] = [];
  // Two different senior habits, one promotion between them. Weighing an option
  // and committing is the mid-to-senior move; framing a choice by how reversible
  // it is, is the senior-to-staff one. They earn the same single step but must not
  // be reported under the same words, because the report quotes these back.
  if (has("rejects_alternative_with_reason") && has("makes_decision")) {
    promotions.push("weighed a real alternative and committed to a choice");
  } else if (has("frames_reversibility_or_risk")) {
    promotions.push("framed the choice by its risk and how reversible it is");
  }
  const failureCount = countIn(FAILURE_SIGNALS);
  if (
    failureCount >= 2 &&
    (has("states_limit_or_breaking_point") || has("gives_detection_signal") || has("says_when_not_to_use_it"))
  ) {
    promotions.push("knows what breaks and how it shows up");
  }
  if (has("quantity_with_unit") || has("concrete_incident")) {
    promotions.push("grounded in a real number or a real incident");
  }
  if (countIn(MECHANISM_SIGNALS) >= 3 && has("chains_cause_two_deep")) {
    promotions.push("explains the mechanism, not just the steps");
  }
  const applied = promotions.slice(0, MAX_PROMOTIONS);

  let band = baseBand + applied.length;

  // Caps. Each is a ceiling, applied after promotions, lowest wins. A cap that
  // depends on an axis only applies when the question afforded that axis.
  const caps: string[] = [];
  const capAt = (ceiling: number, reason: string) => {
    if (band > ceiling) {
      band = ceiling;
      caps.push(reason);
    }
  };

  if (evidence.totalRubricPoints > 0 && evidence.matchedRubricPoints === 0) {
    capAt(1, "did not cover any point the question was asking about");
  }
  if (has("keyword_salad")) {
    capAt(2, "names the right terms without saying how anything works");
  }
  if (has("recitation_not_applied") || has("uniform_depth_across_subtopics")) {
    capAt(4, "recites rather than applies it to the case in front of them");
  }
  if (has("confident_misconception")) {
    capAt(3, "states something wrong with confidence");
  }
  if (evidence.affords.includes("conditionality")) {
    if (countIn(CONDITIONALITY_SIGNALS) === 0) {
      capAt(3, "the question invited a trade-off and none was made");
    }
    // Above proficient the question is whether they WEIGHED anything, not
    // whether they answered. Every published ladder puts the mid-to-senior line
    // here: proposing the one approach that came to mind is competent, comparing
    // it against something and saying why this one wins is not.
    //
    // Requiring a bare "makes_decision" was not enough, and the golden set caught
    // why twice over: an answer that proposes its only idea reads as a decision
    // to a scanner, so a mid answer kept tying a senior one. What separates them
    // is the presence of something to decide BETWEEN.
    const weighedAnAlternative =
      has("rejects_alternative_with_reason") ||
      has("gives_decision_procedure") ||
      (has("names_alternative") && has("makes_decision"));
    if (!weighedAnAlternative) {
      capAt(4, "settled on one approach without weighing it against another");
    }
  }
  if (has("names_alternative") && !has("makes_decision")) {
    capAt(4, "listed the options but never chose one");
  }

  // Calibration demotion, not a cap: at senior level and above, uncertainty that
  // never attaches to a condition is a real gap, but it is worth one band, not a
  // ceiling, because the rest of the answer may still be strong.
  if (
    band >= 4 &&
    !has("conditioned_hedge") &&
    (has("bare_hedge") || has("unconditional_absolute"))
  ) {
    band -= 1;
    caps.push("certainty is not calibrated: absolutes or vague doubt, never a stated condition");
  }

  const finalBand = clampBand(band);
  return {
    band: finalBand,
    baseBand,
    promotions: applied,
    caps,
    axisProfile: profile,
    demonstratedLevel: bandToLevel(finalBand),
  };
}

// Per-axis coverage, 0..1. This is the diagnostic artifact the report is built
// from: it says HOW someone thinks, which is the thing a score cannot say.
// Calibration is scored as a ratio rather than a count, because the count of
// hedges is meaningless and only the conditioned-to-bare balance carries signal.
export function axisProfile(evidence: AnswerEvidence): AxisProfile {
  const has = (code: SignalCode) => evidence.signals.some((s) => s.code === code);
  const fraction = (codes: readonly SignalCode[]) => codes.filter(has).length / codes.length;

  const conditioned = has("conditioned_hedge") ? 1 : 0;
  const uncalibrated = (has("bare_hedge") ? 1 : 0) + (has("unconditional_absolute") ? 1 : 0);
  // No calibration signal at all reads as 0, the same as uncalibrated. It would be
  // tempting to return a neutral 0.5, but unobservedAxes treats 0 as "we have no
  // reading on this axis" and uses that to aim the next question, so a neutral
  // value would make calibration the one axis the interview never probes. Both
  // readings want the same action anyway: ask something that invites a condition.
  const calibration =
    conditioned + uncalibrated === 0 ? 0 : conditioned / (conditioned + uncalibrated);

  return {
    structure: STRUCTURE_LEVELS.indexOf(evidence.structure) / (STRUCTURE_LEVELS.length - 1),
    mechanism: fraction(MECHANISM_SIGNALS),
    conditionality: fraction(CONDITIONALITY_SIGNALS),
    failureAwareness: fraction(FAILURE_SIGNALS),
    concreteness: fraction(CONCRETENESS_SIGNALS),
    calibration,
    coverage:
      evidence.totalRubricPoints > 0
        ? evidence.matchedRubricPoints / evidence.totalRubricPoints
        : 0,
  };
}

// Which axes a session still has no reading on. The engine uses this to choose
// what the next question should try to elicit, so the interview closes evidence
// gaps instead of asking the same shape of question repeatedly.
export function unobservedAxes(reads: AxisProfile[]): Axis[] {
  const axes: Axis[] = [
    "structure",
    "mechanism",
    "conditionality",
    "failureAwareness",
    "concreteness",
    "calibration",
    "coverage",
  ];
  if (reads.length === 0) return axes;
  return axes.filter((axis) => reads.every((r) => r[axis] === 0));
}
