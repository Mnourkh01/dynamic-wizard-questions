import { describe, expect, it } from "vitest";
import {
  type Affordance,
  type AnswerEvidence,
  type Observation,
  type SignalCode,
  type StructureLevel,
  bandToLevel,
  levelToBand,
  readAnswer,
  readBand,
  unobservedAxes,
  verifyQuotes,
} from "./signals";

// Every observation needs a quote, and readBand assumes quotes were already
// verified against the answer, so the fixtures use the code as its own quote.
function sig(...codes: SignalCode[]): Observation[] {
  return codes.map((code) => ({ code, quote: code }));
}

const ALL_AFFORDANCES: Affordance[] = [
  "mechanism",
  "conditionality",
  "failure",
  "quantity",
  "experience",
];

function evidence(input: {
  structure: StructureLevel;
  signals?: Observation[];
  matched?: number;
  total?: number;
  affords?: Affordance[];
  degenerate?: boolean;
}): AnswerEvidence {
  return {
    structure: input.structure,
    signals: input.signals ?? [],
    matchedRubricPoints: input.matched ?? 2,
    totalRubricPoints: input.total ?? 3,
    affords: input.affords ?? ALL_AFFORDANCES,
    degenerate: input.degenerate ?? false,
  };
}

describe("structure sets the base band", () => {
  it("maps each shape to its base", () => {
    expect(readBand(evidence({ structure: "off_target" })).baseBand).toBe(1);
    expect(readBand(evidence({ structure: "single_point" })).baseBand).toBe(1);
    expect(readBand(evidence({ structure: "listed_unlinked" })).baseBand).toBe(2);
    expect(readBand(evidence({ structure: "integrated_purpose" })).baseBand).toBe(3);
    expect(readBand(evidence({ structure: "generalized_beyond" })).baseBand).toBe(4);
  });

  it("a broad, correct, unintegrated answer stays below a narrower integrated one", () => {
    const broadAndFlat = readBand(
      evidence({ structure: "listed_unlinked", matched: 3, total: 3 }),
    );
    const narrowAndDeep = readBand(
      evidence({ structure: "integrated_purpose", matched: 1, total: 3, signals: sig("declares_scope") }),
    );
    expect(narrowAndDeep.band).toBeGreaterThan(broadAndFlat.band);
  });
});

describe("promotions", () => {
  it("weighing an alternative and committing promotes one band", () => {
    const base = readBand(evidence({ structure: "integrated_purpose" }));
    const promoted = readBand(
      evidence({
        structure: "integrated_purpose",
        signals: sig("names_alternative", "rejects_alternative_with_reason", "makes_decision"),
      }),
    );
    expect(promoted.band).toBe(base.band + 1);
  });

  it("naming an alternative without deciding does not promote, and caps at 4", () => {
    const r = readBand(
      evidence({
        structure: "generalized_beyond",
        signals: sig("names_alternative", "quantity_with_unit", "names_failure_mode", "gives_detection_signal"),
      }),
    );
    expect(r.band).toBe(4);
    expect(r.caps).not.toHaveLength(0);
  });

  it("caps an undecided answer even when the question never invited a trade-off", () => {
    // Volunteering an alternative proves the candidate could engage with one, so
    // this cap is self-affording and does not go through the affordance gate.
    const r = readBand(
      evidence({
        structure: "generalized_beyond",
        signals: sig("names_alternative", "quantity_with_unit", "concrete_incident", "names_failure_mode", "says_when_not_to_use_it"),
        affords: ["mechanism", "quantity", "failure", "experience"],
      }),
    );
    expect(r.band).toBe(4);
    expect(r.caps.join(" ")).toContain("never chose one");
  });

  it("failure awareness needs depth, not just a mention", () => {
    const mentionOnly = readBand(
      evidence({ structure: "integrated_purpose", signals: sig("names_failure_mode") }),
    );
    const withDepth = readBand(
      evidence({
        structure: "integrated_purpose",
        signals: sig("names_failure_mode", "gives_detection_signal"),
      }),
    );
    expect(mentionOnly.promotions).toHaveLength(0);
    expect(withDepth.promotions).toHaveLength(1);
  });

  it("credits reversibility framing on its own, under its own reason", () => {
    const r = readBand(
      evidence({ structure: "integrated_purpose", signals: sig("frames_reversibility_or_risk") }),
    );
    expect(r.band).toBe(4);
    expect(r.promotions).toEqual(["framed the choice by its risk and how reversible it is"]);
  });

  it("does not pay twice when an answer both weighs an option and frames the risk", () => {
    const r = readBand(
      evidence({
        structure: "integrated_purpose",
        signals: sig(
          "rejects_alternative_with_reason",
          "makes_decision",
          "frames_reversibility_or_risk",
        ),
      }),
    );
    expect(r.promotions).toEqual(["weighed a real alternative and committed to a choice"]);
    expect(r.band).toBe(4);
  });

  it("caps the total promotion at two so one strong habit cannot carry a thin answer", () => {
    const r = readBand(
      evidence({
        structure: "listed_unlinked",
        signals: sig(
          "rejects_alternative_with_reason",
          "makes_decision",
          "names_failure_mode",
          "says_when_not_to_use_it",
          "quantity_with_unit",
          "concrete_incident",
          "names_working_parts",
          "states_what_it_does",
          "chains_cause_two_deep",
        ),
      }),
    );
    expect(r.promotions).toHaveLength(2);
    expect(r.band).toBe(4);
  });
});

describe("caps", () => {
  it("covering nothing the question asked about floors the band at 1", () => {
    const r = readBand(
      evidence({
        structure: "generalized_beyond",
        matched: 0,
        total: 4,
        signals: sig("quantity_with_unit", "names_failure_mode", "gives_detection_signal"),
      }),
    );
    expect(r.band).toBe(1);
  });

  it("keyword salad caps at 2 no matter how fluent the answer reads", () => {
    const r = readBand(
      evidence({
        structure: "integrated_purpose",
        signals: sig("keyword_salad", "names_working_parts", "makes_decision"),
      }),
    );
    expect(r.band).toBe(2);
  });

  it("a confident wrong claim caps at 3", () => {
    const r = readBand(
      evidence({
        structure: "generalized_beyond",
        signals: sig(
          "confident_misconception",
          "rejects_alternative_with_reason",
          "makes_decision",
          "quantity_with_unit",
        ),
      }),
    );
    expect(r.band).toBe(3);
  });

  it("recitation that is never applied caps at 4", () => {
    const r = readBand(
      evidence({
        structure: "generalized_beyond",
        signals: sig(
          "recitation_not_applied",
          "rejects_alternative_with_reason",
          "makes_decision",
          "quantity_with_unit",
          "concrete_incident",
        ),
      }),
    );
    expect(r.band).toBe(4);
  });
});

describe("a question with no rubric", () => {
  it("does not floor the band, because there is no coverage to measure", () => {
    const r = readBand(
      evidence({
        structure: "integrated_purpose",
        matched: 0,
        total: 0,
        signals: sig("names_working_parts", "chains_cause_two_deep", "states_what_it_does"),
      }),
    );
    expect(r.band).toBe(3);
    expect(r.axisProfile.coverage).toBe(0);
  });
});

describe("readAnswer", () => {
  const answer = "We retry with jitter, otherwise every client wakes up at the same instant.";

  it("verifies quotes before mapping, so an invented observation earns nothing", () => {
    const withInvented = readAnswer(answer, {
      structure: "integrated_purpose",
      signals: [
        { code: "chains_cause_two_deep", quote: "otherwise every client wakes up at the same instant" },
        { code: "quantity_with_unit", quote: "p99 under 40ms" },
        { code: "concrete_incident", quote: "when this took us down in March" },
      ],
      matchedRubricPoints: 2,
      totalRubricPoints: 3,
      affords: ["mechanism"],
      degenerate: false,
    });
    expect(withInvented.promotions).toHaveLength(0);
    expect(withInvented.axisProfile.concreteness).toBe(0);
  });
});

describe("the affordance gate", () => {
  const noTradeoffSignals = sig("names_working_parts", "states_what_it_does");

  it("penalizes a missing trade-off only when the question invited one", () => {
    const invited = readBand(
      evidence({
        structure: "generalized_beyond",
        signals: noTradeoffSignals,
        affords: ["mechanism", "conditionality"],
      }),
    );
    const notInvited = readBand(
      evidence({
        structure: "generalized_beyond",
        signals: noTradeoffSignals,
        affords: ["mechanism"],
      }),
    );
    expect(invited.band).toBe(3);
    expect(notInvited.band).toBe(4);
  });

  it("caps at 4 when the question invited a choice and the answer reasoned but never chose", () => {
    // Regression from the first golden-set run: a mid answer tied a senior one
    // because one assumption stated in passing satisfied the weaker cap below.
    const reasonedNoChoice = readBand(
      evidence({
        structure: "integrated_purpose",
        signals: sig(
          "states_assumptions",
          "names_working_parts",
          "states_what_it_does",
          "chains_cause_two_deep",
          "names_failure_mode",
          "gives_detection_signal",
        ),
      }),
    );
    expect(reasonedNoChoice.band).toBe(4);
    expect(reasonedNoChoice.caps.join(" ")).toContain("without weighing it against another");

    const weighed = readBand(
      evidence({
        structure: "integrated_purpose",
        signals: sig(
          "states_assumptions",
          "names_working_parts",
          "states_what_it_does",
          "chains_cause_two_deep",
          "names_failure_mode",
          "gives_detection_signal",
          "rejects_alternative_with_reason",
          "makes_decision",
        ),
      }),
    );
    expect(weighed.band).toBe(5);
  });

  it("does not treat proposing the only idea mentioned as weighing anything", () => {
    // The exact live failure: a scanner reads a proposal as a decision, and
    // without something to decide BETWEEN, that must not clear the cap.
    const proposedOnly = readBand(
      evidence({
        structure: "integrated_purpose",
        signals: sig(
          "states_assumptions",
          "makes_decision",
          "chains_cause_two_deep",
          "names_working_parts",
          "states_what_it_does",
          "names_failure_mode",
          "gives_detection_signal",
        ),
      }),
    );
    expect(proposedOnly.band).toBe(4);

    const named = readBand(
      evidence({
        structure: "integrated_purpose",
        signals: sig(
          "states_assumptions",
          "names_alternative",
          "makes_decision",
          "chains_cause_two_deep",
          "names_working_parts",
          "states_what_it_does",
          "names_failure_mode",
          "gives_detection_signal",
        ),
      }),
    );
    expect(named.band).toBe(5);
  });

  it("accepts a decision procedure in place of a single decision", () => {
    const r = readBand(
      evidence({
        structure: "integrated_purpose",
        signals: sig(
          "states_assumptions",
          "gives_decision_procedure",
          "names_failure_mode",
          "says_when_not_to_use_it",
          "quantity_with_unit",
        ),
      }),
    );
    expect(r.band).toBe(5);
  });

  it("does not demand a decision from a question that never invited one", () => {
    const r = readBand(
      evidence({
        structure: "integrated_purpose",
        signals: sig(
          "names_working_parts",
          "states_what_it_does",
          "chains_cause_two_deep",
          "quantity_with_unit",
        ),
        affords: ["mechanism", "quantity"],
      }),
    );
    expect(r.band).toBe(5);
  });

  it("still credits a candidate who shows more than the question asked for", () => {
    const r = readBand(
      evidence({
        structure: "integrated_purpose",
        signals: sig("rejects_alternative_with_reason", "makes_decision"),
        affords: ["mechanism"],
      }),
    );
    expect(r.band).toBe(4);
  });
});

describe("calibration", () => {
  it("vague doubt with no stated condition costs a band at senior level", () => {
    const withCondition = readBand(
      evidence({
        structure: "generalized_beyond",
        signals: sig("rejects_alternative_with_reason", "makes_decision", "conditioned_hedge"),
      }),
    );
    const withoutCondition = readBand(
      evidence({
        structure: "generalized_beyond",
        signals: sig("rejects_alternative_with_reason", "makes_decision", "bare_hedge"),
      }),
    );
    expect(withCondition.band).toBe(5);
    expect(withoutCondition.band).toBe(4);
  });

  it("does not demote a junior answer for hedging vaguely", () => {
    const r = readBand(evidence({ structure: "listed_unlinked", signals: sig("bare_hedge") }));
    expect(r.band).toBe(2);
    expect(r.caps).toHaveLength(0);
  });

  it("reads as unobserved, not neutral, when the answer hedged neither way", () => {
    const r = readBand(evidence({ structure: "integrated_purpose" }));
    expect(r.axisProfile.calibration).toBe(0);
    expect(unobservedAxes([r.axisProfile])).toContain("calibration");
  });

  it("reports calibration as a ratio, so hedge count alone means nothing", () => {
    const calibrated = readBand(
      evidence({ structure: "integrated_purpose", signals: sig("conditioned_hedge") }),
    );
    const uncalibrated = readBand(
      evidence({
        structure: "integrated_purpose",
        signals: sig("bare_hedge", "unconditional_absolute"),
      }),
    );
    expect(calibrated.axisProfile.calibration).toBe(1);
    expect(uncalibrated.axisProfile.calibration).toBe(0);
  });
});

describe("degenerate answers", () => {
  it("scores 1 without consulting any signal", () => {
    const r = readBand(
      evidence({
        structure: "generalized_beyond",
        degenerate: true,
        signals: sig("quantity_with_unit", "makes_decision"),
      }),
    );
    expect(r.band).toBe(1);
    expect(r.demonstratedLevel).toBe(bandToLevel(1));
  });
});

describe("quote verification", () => {
  const answer = "We shard by tenant id, and a hot tenant still pins one node.";

  it("keeps observations whose quote appears in the answer", () => {
    const kept = verifyQuotes(answer, [{ code: "names_failure_mode", quote: "a hot tenant still pins one node" }]);
    expect(kept).toHaveLength(1);
  });

  it("drops a quote the answer never contained, which is how hallucinated credit dies", () => {
    const kept = verifyQuotes(answer, [
      { code: "quantity_with_unit", quote: "p99 stays under 40ms" },
      { code: "names_failure_mode", quote: "a hot tenant still pins one node" },
    ]);
    expect(kept.map((o) => o.code)).toEqual(["names_failure_mode"]);
  });

  it("tolerates reflowed whitespace and case but nothing else", () => {
    expect(verifyQuotes(answer, [{ code: "names_working_parts", quote: "We  shard\n by TENANT id" }])).toHaveLength(1);
    expect(verifyQuotes(answer, [{ code: "names_working_parts", quote: "we shard by customer id" }])).toHaveLength(0);
  });

  it("drops an empty quote", () => {
    expect(verifyQuotes(answer, [{ code: "makes_decision", quote: "   " }])).toHaveLength(0);
  });
});

// The hard gate from the plan: whatever the point values do, the ORDER must be
// right. These fixtures are the observation sets a scanner should produce for real
// answers at each level, written from the band ladder in
// docs/research/answer-level-signals.md.
describe("ordering across the ladder", () => {
  const ladder: Array<{ name: string; expected: number; ev: AnswerEvidence }> = [
    {
      name: "junk: answers a different, surface-similar question",
      expected: 1,
      ev: evidence({ structure: "off_target", matched: 0, total: 3 }),
    },
    {
      name: "novice: one remembered fact, no mechanism",
      expected: 1,
      ev: evidence({ structure: "single_point", matched: 1, total: 3, signals: sig("bare_hedge") }),
    },
    {
      name: "keyword salad: fluent, dense with terms, explains nothing",
      expected: 2,
      ev: evidence({
        structure: "integrated_purpose",
        matched: 2,
        total: 3,
        signals: sig("keyword_salad", "unconditional_absolute"),
      }),
    },
    {
      name: "junior: correct happy path, pieces never joined",
      expected: 2,
      ev: evidence({
        structure: "listed_unlinked",
        matched: 2,
        total: 3,
        signals: sig("names_working_parts", "states_what_it_does"),
      }),
    },
    {
      name: "mid: states the purpose, one causal chain, one failure mode, no decision",
      expected: 3,
      ev: evidence({
        structure: "integrated_purpose",
        matched: 3,
        total: 3,
        signals: sig(
          "names_working_parts",
          "states_what_it_does",
          "chains_cause_two_deep",
          "names_failure_mode",
        ),
      }),
    },
    {
      name: "senior: scopes it, rejects an alternative, commits, knows what breaks and how it shows",
      expected: 5,
      ev: evidence({
        structure: "integrated_purpose",
        matched: 3,
        total: 3,
        signals: sig(
          "states_assumptions",
          "names_alternative",
          "rejects_alternative_with_reason",
          "makes_decision",
          "names_failure_mode",
          "gives_detection_signal",
          "quantity_with_unit",
          "conditioned_hedge",
        ),
      }),
    },
    {
      name: "staff: reframes the premise, says where its own advice is wrong, real incident",
      expected: 6,
      ev: evidence({
        structure: "generalized_beyond",
        matched: 3,
        total: 3,
        signals: sig(
          "states_invariant",
          "reasons_counterfactually",
          "chains_cause_two_deep",
          "names_working_parts",
          "rejects_alternative_with_reason",
          "makes_decision",
          "frames_reversibility_or_risk",
          "says_when_not_to_use_it",
          "states_limit_or_breaking_point",
          "concrete_incident",
          "conditioned_hedge",
          "points_at_what_it_omits",
        ),
      }),
    },
  ];

  for (const { name, expected, ev } of ladder) {
    it(`${name} reads as band ${expected}`, () => {
      expect(readBand(ev).band).toBe(expected);
    });
  }

  it("never places a stronger answer below a weaker one, and does separate them", () => {
    const bands = ladder.map((row) => readBand(row.ev).band);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]).toBeGreaterThanOrEqual(bands[i - 1]);
    }
    // Ordering alone would also hold if the mapping collapsed every answer to one
    // band, so pin the spread too.
    expect(new Set(bands).size).toBeGreaterThanOrEqual(5);
    expect(Math.max(...bands) - Math.min(...bands)).toBe(5);
  });

  it("maps bands onto the engine's 1..10 level scale in order", () => {
    const levels = ladder.map((row) => readBand(row.ev).demonstratedLevel);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    }
    expect(levels[0]).toBeLessThan(4);
    expect(levels[levels.length - 1]).toBe(10);
  });
});

describe("levelToBand", () => {
  it("round-trips every band through its level", () => {
    for (let band = 1; band <= 6; band++) {
      expect(levelToBand(bandToLevel(band))).toBe(band);
    }
  });

  it("snaps a level between two bands to the nearer one", () => {
    expect(levelToBand(1)).toBe(1);
    expect(levelToBand(6)).toBe(3);
    expect(levelToBand(8)).toBe(4);
    expect(levelToBand(10)).toBe(6);
  });

  it("does not throw on nonsense", () => {
    expect(levelToBand(Number.NaN)).toBe(1);
  });
});

describe("unobservedAxes", () => {
  it("reports every axis before anything has been read", () => {
    expect(unobservedAxes([])).toHaveLength(7);
  });

  it("drops an axis once any answer has shown it", () => {
    const read = readBand(
      evidence({ structure: "integrated_purpose", signals: sig("names_failure_mode") }),
    );
    const missing = unobservedAxes([read.axisProfile]);
    expect(missing).not.toContain("failureAwareness");
    expect(missing).toContain("conditionality");
  });
});
