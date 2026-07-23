import { DISCOVERY_LEVEL } from "./constants";
import type { Language } from "./types";

// The 101 opener is a fixed, simple, SINGLE "explain the concept" question,
// TEMPLATED from the topic name rather than written by an agent. Two reasons:
//   1. No AI call on the Begin path, so the first question is fast (instant for a
//      pre-seeded role, just the topic-planner for a custom one).
//   2. It is guaranteed to be ONE plain question, never a multi-part prompt an
//      agent might cram together.
// The answer is still AI-graded for DEPTH, which is what drives the adaptive jump
// (a shallow answer stays low, a deep one leaps up several levels). The rubric is a
// generic surface/practical/deep ladder the grader uses to read that depth; it is
// never shown to the candidate.
export interface OpenerQuestion {
  text: string;
  rubricPoints: string[];
  gold: string;
  level: number;
}

export function templatedOpener(topic: string, language: Language): OpenerQuestion {
  const t = topic.trim();
  if (language === "ar") {
    return {
      text: `بكلامك انت، اشرح إيه هو "${t}". ابدأ بسيط، بس ورّي أكبر عمق عندك فعلا.`,
      rubricPoints: [
        `يوضّح صح وببساطة إيه هو "${t}"`,
        `يشرح إزاي بيشتغل أو بيتستخدم في الواقع`,
        `يظهر عمق حقيقي: تفاصيل داخلية، مفاضلات، حالات صعبة، أو أنماط فشل`,
      ],
      gold: `الإجابة القوية بتعرّف "${t}" صح وببساطة، وتشرح إزاي بيشتغل فعلا، وبعدين تظهر عمق (تفاصيل داخلية أو مفاضلات أو أنماط فشل) مش مجرد تعريف من كتاب.`,
      level: DISCOVERY_LEVEL,
    };
  }
  return {
    text: `In your own words, explain what "${t}" is. Keep it simple to start, but show as much depth as you genuinely have.`,
    rubricPoints: [
      `States clearly and correctly what "${t}" is`,
      `Explains how it works or how it is used in practice`,
      `Shows real depth: internals, trade-offs, edge cases, or failure modes`,
    ],
    gold: `A strong answer defines "${t}" correctly in plain terms, explains how it actually works or is used, then shows depth (internals, trade-offs, or failure modes) rather than stopping at a textbook definition.`,
    level: DISCOVERY_LEVEL,
  };
}
