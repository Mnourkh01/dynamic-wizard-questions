import { describe, expect, it } from "vitest";
import {
  DISCOVERY_LEVEL,
  GLOBAL_MAX_QUESTIONS,
  INITIAL_SIGMA,
  MAX_QUESTIONS_PER_TOPIC,
  NEUTRAL_START_THETA,
  SIGMA_FLOOR,
} from "./constants";
import {
  applyGrade,
  decide,
  deterministicConfidence,
  initTopicState,
  isTopicConverged,
  nextDifficulty,
  selectTopicIndex,
} from "./policy";
import type { Grade, TopicBlueprint, TopicState } from "./types";

function topic(overrides: Partial<TopicState> = {}): TopicState {
  return {
    name: "T",
    importance: 100,
    theta: NEUTRAL_START_THETA,
    sigma: INITIAL_SIGMA,
    startLevel: 5,
    questionsAsked: 0,
    answeredCount: 0,
    consecutiveStrong: 0,
    converged: false,
    points: 0,
    ...overrides,
  };
}

function grade(overrides: Partial<Grade> = {}): Grade {
  return {
    score: 80,
    demonstratedLevel: 6,
    matchedCount: 3,
    missingCount: 1,
    degenerate: false,
    ...overrides,
  };
}

describe("initTopicState", () => {
  it("starts the running estimate neutral, stores the startLevel separately", () => {
    const bp: TopicBlueprint = { name: "Concurrency", importance: 300, startLevel: 8 };
    const t = initTopicState(bp);
    expect(t.theta).toBe(NEUTRAL_START_THETA); // NOT the startLevel
    expect(t.startLevel).toBe(8);
    expect(t.sigma).toBe(INITIAL_SIGMA);
    expect(t.answeredCount).toBe(0);
  });

  it("clamps an out-of-range startLevel", () => {
    expect(initTopicState({ name: "x", importance: 1, startLevel: 99 }).startLevel).toBe(10);
    expect(initTopicState({ name: "x", importance: 1, startLevel: -5 }).startLevel).toBe(1);
  });
});

describe("deterministicConfidence", () => {
  it("uses matched/(matched+missing), clamped to [0.3, 0.8]", () => {
    expect(deterministicConfidence(grade({ matchedCount: 4, missingCount: 1 }))).toBe(0.8);
    expect(deterministicConfidence(grade({ matchedCount: 1, missingCount: 4 }))).toBe(0.3);
    expect(deterministicConfidence(grade({ matchedCount: 3, missingCount: 3 }))).toBeCloseTo(0.5, 10);
  });

  it("returns the floor for degenerate answers", () => {
    expect(deterministicConfidence(grade({ degenerate: true, matchedCount: 9, missingCount: 0 }))).toBe(0.3);
  });

  it("returns 0.5 when there are no rubric points at all", () => {
    expect(deterministicConfidence(grade({ matchedCount: 0, missingCount: 0 }))).toBe(0.5);
  });
});

describe("applyGrade (Kalman-style update)", () => {
  it("moves theta toward the demonstrated level and shrinks sigma", () => {
    // theta 5, sigma 2, c=0.8 (4/5), K=2/3 => theta 6.6, sigma 0.9333
    const next = applyGrade(topic(), grade({ score: 90, demonstratedLevel: 8, matchedCount: 4, missingCount: 1 }));
    expect(next.theta).toBeCloseTo(6.6, 6);
    expect(next.sigma).toBeCloseTo(0.933333, 5);
    expect(next.answeredCount).toBe(1);
    expect(next.consecutiveStrong).toBe(1);
    expect(next.converged).toBe(false); // only 1 answer < min 2
  });

  it("never lets sigma fall below the floor", () => {
    let t = topic({ sigma: 0.4 });
    for (let i = 0; i < 6; i++) t = applyGrade(t, grade({ score: 95, demonstratedLevel: 9 }));
    expect(t.sigma).toBeGreaterThanOrEqual(SIGMA_FLOOR);
  });

  it("resets the strong streak on a weak or degenerate answer", () => {
    const strong = applyGrade(topic({ consecutiveStrong: 2 }), grade({ score: 90 }));
    expect(strong.consecutiveStrong).toBe(3);
    const weak = applyGrade(topic({ consecutiveStrong: 2 }), grade({ score: 30 }));
    expect(weak.consecutiveStrong).toBe(0);
    const degen = applyGrade(topic({ consecutiveStrong: 2 }), grade({ score: 90, degenerate: true }));
    expect(degen.consecutiveStrong).toBe(0);
  });

  it("keeps probing while the candidate is still acing below the ceiling", () => {
    let t = topic();
    t = applyGrade(t, grade({ score: 90, demonstratedLevel: 8, matchedCount: 4, missingCount: 1 }));
    t = applyGrade(t, grade({ score: 90, demonstratedLevel: 8, matchedCount: 4, missingCount: 1 }));
    expect(t.answeredCount).toBe(2);
    expect(t.consecutiveStrong).toBe(2);
    expect(t.converged).toBe(false); // still climbing to find the ceiling
  });

  it("converges once a strong streak breaks and the level is bracketed", () => {
    let t = topic();
    t = applyGrade(t, grade({ score: 90, demonstratedLevel: 8, matchedCount: 4, missingCount: 1 }));
    t = applyGrade(t, grade({ score: 90, demonstratedLevel: 8, matchedCount: 4, missingCount: 1 }));
    t = applyGrade(t, grade({ score: 30, demonstratedLevel: 4, matchedCount: 1, missingCount: 4 }));
    expect(t.consecutiveStrong).toBe(0);
    expect(t.converged).toBe(true);
  });
});

describe("isTopicConverged", () => {
  it("requires the minimum answered questions before a sigma stop", () => {
    expect(isTopicConverged(topic({ sigma: 0.1, answeredCount: 1 }))).toBe(false);
    expect(isTopicConverged(topic({ sigma: 0.1, answeredCount: 2 }))).toBe(true);
  });

  it("stops at the hard per-topic cap regardless of sigma", () => {
    expect(isTopicConverged(topic({ sigma: 5, answeredCount: MAX_QUESTIONS_PER_TOPIC }))).toBe(true);
  });
});

describe("nextDifficulty", () => {
  it("opens every topic with a broad discovery question, ignoring the startLevel", () => {
    const d = nextDifficulty(topic({ answeredCount: 0, startLevel: 8, theta: 5 }));
    expect(d.difficulty).toBe(DISCOVERY_LEVEL);
    expect(d.discovery).toBe(true);
    expect(d.ceilingProbe).toBe(false);
    expect(d.format).toBe("mcq");
  });

  it("tracks the live estimate after the first question (fast-forward)", () => {
    const d = nextDifficulty(topic({ answeredCount: 1, theta: 6.4, consecutiveStrong: 0 }));
    expect(d.difficulty).toBe(6);
    expect(d.discovery).toBe(false);
    expect(d.ceilingProbe).toBe(false);
    expect(d.format).toBe("mcq");
  });

  it("probes one level up after a run of strong answers", () => {
    const d = nextDifficulty(topic({ answeredCount: 2, theta: 6, consecutiveStrong: 2 }));
    expect(d.difficulty).toBe(7);
    expect(d.ceilingProbe).toBe(true);
    expect(d.format).toBe("text");
  });
});

describe("selectTopicIndex", () => {
  it("picks the highest-uncertainty topic, tie-broken by importance", () => {
    const topics = [
      topic({ name: "a", sigma: 0.8, importance: 100 }),
      topic({ name: "b", sigma: 1.5, importance: 100 }),
      topic({ name: "c", sigma: 1.5, importance: 300 }),
    ];
    expect(selectTopicIndex(topics)).toBe(2); // same sigma as b, higher importance
  });

  it("skips converged topics and returns -1 when all converged", () => {
    const topics = [topic({ converged: true }), topic({ converged: true })];
    expect(selectTopicIndex(topics)).toBe(-1);
  });
});

describe("decide", () => {
  it("stops at the global question cap", () => {
    expect(decide([topic()], GLOBAL_MAX_QUESTIONS).kind).toBe("done");
  });

  it("stops when every topic has converged", () => {
    expect(decide([topic({ converged: true })], 3).kind).toBe("done");
  });

  it("opens with a discovery question on the selected topic", () => {
    const d = decide([topic({ answeredCount: 0, startLevel: 7 })], 0);
    expect(d).toEqual({
      kind: "ask",
      topicIndex: 0,
      difficulty: DISCOVERY_LEVEL,
      ceilingProbe: false,
      discovery: true,
      format: "mcq",
    });
  });
});
