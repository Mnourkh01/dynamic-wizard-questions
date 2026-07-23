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

// A role-level warm-up, used on the live (custom / specialized) path while the
// topic blueprint is still being built in the background. It is the SAME kind of
// "explain and show depth" probe as templatedOpener, but its subject is the role
// or stack the user picked, so it can be shown INSTANTLY at Begin with no AI call
// and before any topic exists. Its AI-graded depth seeds the assessment's starting
// level, exactly as the per-topic 101 opener does. The subject reads naturally
// whether it is a role ("Backend Engineer") or a stack ("Python, GCP, LLM agents").
export function roleWarmupOpener(subject: string, language: Language): OpenerQuestion {
  const s = subject.trim();
  if (language === "ar") {
    return {
      text: `للتسخين: بكلامك انت، إيه اللي بتشتغل عليه في "${s}"، وإيه أكتر حاجة بتعرفها كويس فيه؟ ابدأ بسيط، وبعدين ورّي أكبر عمق عندك فعلا.`,
      rubricPoints: [
        `يوصّف مجال "${s}" صح وببساطة`,
        `يشرح إزاي الشغل بيتم فعلا في المجال ده`,
        `يظهر عمق حقيقي: تفاصيل، مفاضلات، حالات صعبة، أو أنماط فشل`,
      ],
      gold: `الإجابة القوية بتوصّف مجال "${s}" صح وببساطة، وتشرح إزاي الشغل بيتم فعلا، وبعدين تظهر عمق (تفاصيل أو مفاضلات أو أنماط فشل) مش مجرد كلام عام.`,
      level: DISCOVERY_LEVEL,
    };
  }
  return {
    text: `To warm up: in your own words, what do you work on in "${s}", and which parts do you know best? Keep it simple to start, then show as much depth as you genuinely have.`,
    rubricPoints: [
      `Describes the area of "${s}" clearly and correctly`,
      `Explains how the work is actually done in this area`,
      `Shows real depth: specifics, trade-offs, edge cases, or failure modes`,
    ],
    gold: `A strong answer describes "${s}" clearly, explains how the work is actually done, then shows depth (specifics, trade-offs, or failure modes) rather than staying generic.`,
    level: DISCOVERY_LEVEL,
  };
}
