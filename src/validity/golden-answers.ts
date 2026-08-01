import type { Affordance } from "@/core/signals";
import type { Language } from "@/core/types";

// Hand-written answers with the band each should read as. This is the gate the
// scanner has to pass before the written interview can replace the MCQ bank.
//
// Honest limitation, stated where it cannot be missed: these are labelled by one
// author against one instrument, so the set proves the scanner agrees with THIS
// project's definition of the bands. It is a strong gate against ordering
// failures, drift and gaming, and a weak gate against the definition itself
// being wrong. That is why the release criterion is ordering on ranked pairs,
// which is the part a single labeller can get right, rather than exact agreement.
//
// The unit fixtures in core/signals.test.ts are deliberately NOT reused here.
// Tuning the scanner against the same data that pins the mapping would measure
// nothing.

export interface GoldenItem {
  id: string;
  question: string;
  rubricPoints: string[];
  gold: string;
  affords: Affordance[];
  answer: string;
  expectedBand: number;
  language: Language;
  // Why this band, so a disagreement is a conversation about the instrument
  // rather than an argument about a number.
  note: string;
}

const INDEX_QUESTION = {
  question:
    "A Postgres table has about 50 million rows. A query that filters on two columns has become slow. How would you approach it?",
  rubricPoints: [
    "Measures before changing anything, for example by reading the query plan",
    "Identifies why the current access path is slow, such as a sequential scan or a poorly ordered index",
    "Proposes an index or query change that matches the actual filter",
    "Accounts for the cost of the change, such as write overhead, index size, or bloat",
  ],
  gold: "A strong answer starts by looking at the real plan rather than guessing, explains why the planner chose that path, proposes an index whose column order matches the predicates and their selectivity, and accounts for what the index costs on writes and in storage.",
  affords: ["mechanism", "conditionality", "failure", "quantity", "experience"] as Affordance[],
};

const RERENDER_QUESTION = {
  question:
    "A React list re-renders on every keystroke in an unrelated input on the same page. Why does that happen, and what would you do about it?",
  rubricPoints: [
    "Explains that a state change re-renders the component subtree by default",
    "Identifies what breaks memoization, such as a new object or function identity each render",
    "Proposes a fix that addresses the identified cause",
    "Notes when the fix is not worth applying",
  ],
  gold: "A strong answer explains that setState re-renders the owning component and its children, identifies the specific reason memoization is not helping (a prop whose identity changes each render, or state held too high), proposes moving the state down or stabilizing the identity, and says when the optimization is not worth its complexity.",
  affords: ["mechanism", "conditionality", "failure", "experience"] as Affordance[],
};

// The affordance test. A plain definition question cannot invite a trade-off, so
// a strong mechanical explanation must NOT be capped for making no decision.
const CACHING_QUESTION = {
  question: "In your own words, what is HTTP caching?",
  rubricPoints: [
    "States what HTTP caching is and what it is for",
    "Explains how a cache decides whether a stored response can be reused",
    "Mentions where caching happens, such as the browser or an intermediary",
  ],
  gold: "A strong answer says that HTTP caching stores responses so they can be reused instead of refetched, explains freshness and revalidation as the mechanism deciding reuse, and notes that caches sit in the browser and in intermediaries.",
  affords: ["mechanism"] as Affordance[],
};

export const GOLDEN_ANSWERS: GoldenItem[] = [
  // ---- Postgres index question, the full ladder ----------------------------
  {
    ...INDEX_QUESTION,
    id: "idx-1-offtarget",
    expectedBand: 1,
    language: "en",
    note: "Answers a different question (how to write a query) and covers no rubric point.",
    answer:
      "Postgres is a relational database. You write queries in SQL using SELECT, FROM and WHERE. To get data from a table you write SELECT star FROM the table name and then you can add a WHERE clause to filter it.",
  },
  {
    ...INDEX_QUESTION,
    id: "idx-2-novice",
    expectedBand: 1,
    language: "en",
    note: "One remembered fact, no mechanism, bare hedging, nothing connected.",
    answer:
      "I think you need to add an index. Indexes make queries faster. I am not sure exactly how but usually adding an index on the columns fixes slow queries.",
  },
  {
    ...INDEX_QUESTION,
    id: "idx-3-junior",
    expectedBand: 2,
    language: "en",
    note: "Correct happy path, several right pieces listed in sequence, never tied to why. Textbook multistructural.",
    answer:
      "First I would run EXPLAIN on the query to see the plan. Then I would add an index on the two columns that are in the WHERE clause. After that I would run ANALYZE so the statistics are up to date. Then I would run the query again and check if it got faster. If it is still slow I would look at whether the query can be rewritten.",
  },
  {
    ...INDEX_QUESTION,
    id: "idx-4-mid",
    expectedBand: 3,
    language: "en",
    note: "States the purpose up front and chains cause to effect, names a failure mode, but never weighs an option or decides. Question afforded conditionality, so it caps at mid.",
    answer:
      "The point of the exercise is to stop the planner from reading the whole table, so the first thing is to see what it is actually doing. EXPLAIN ANALYZE will show whether it is a sequential scan or an index scan and how far the row estimates are from reality. If it is doing a sequential scan on 50 million rows then every query is reading the entire heap, which is why it is slow. A composite index covering both predicates would let it seek instead of scan. One thing that catches people is that if the statistics are stale the planner can pick a bad plan even when a perfectly good index exists.",
  },
  {
    ...INDEX_QUESTION,
    id: "idx-5-senior",
    expectedBand: 5,
    language: "en",
    note: "Scopes it, rejects an alternative with a reason and commits, quantities, failure mode with a detection signal, calibrated uncertainty.",
    answer:
      "I am assuming this is an OLTP path and not a reporting query, because the answer changes completely if it is a nightly report. I would start with EXPLAIN ANALYZE BUFFERS rather than the estimated plan, since I want the real row counts and whether it is hitting disk. On 50 million rows a sequential scan is a few seconds of pure IO, so if the plan shows a seq scan the fix is an access path, not query rewriting. For a composite index the column order matters: the more selective column goes first, and if one predicate is a range then it goes last, otherwise everything after it in the index is unusable for seeking. I would not reach for a covering index with INCLUDE here even though it would avoid the heap fetch, because this table is 50 million rows and every extra column widens the index on a write-heavy table. The cost to watch is write amplification: each index is another structure to maintain on insert, and you would see it as rising commit latency with flat CPU. I would need the actual predicate selectivity before committing to the column order, so I would check pg_stats for n_distinct first rather than guess.",
  },
  {
    ...INDEX_QUESTION,
    id: "idx-6-staff",
    expectedBand: 6,
    language: "en",
    note: "Reframes the premise, invariant, counterfactual, says when its own advice is wrong, a real incident with numbers, compression with a pointer.",
    answer:
      "Before indexing anything I would ask whether this query should be running at all, because the most common version of this problem is a query that has quietly become a full-table aggregate as the table grew, and no index makes that fast. So the first question is what the query is for, not what index it needs. Assuming it is a genuine point lookup, the invariant I care about is that the number of rows the plan touches stays roughly constant as the table grows. If the plan shows rows scanned growing with table size, an index is treating the symptom. Remove the index from the equation for a second and the query becomes a sequential scan over the heap, which is IO bound and gets linearly worse forever, so the index is buying an asymptotic change, not a constant factor, and that is why it is worth paying write cost for. Where my own recommendation is wrong: on a table with a very high write rate and a low read rate, adding a second or third index can cost more in insert latency and bloat than the query saves, and I have shipped exactly that mistake. We added a composite index to fix a 400ms read on an events table and pushed p99 insert from about 8ms to 30ms, and had to drop it a week later and fix the read with a partial index scoped to the recent window instead. Partial indexes and BRIN are the other two things I would consider here, happy to go into the partial index case since that is the one that usually applies.",
  },

  // ---- Adversarial items on the same question -----------------------------
  {
    ...INDEX_QUESTION,
    id: "idx-7-keyword-salad",
    expectedBand: 1,
    language: "en",
    note: "Fluent, confident, dense with real vocabulary, explains nothing and covers no rubric point. Label corrected from 2 to 1 after the first gate run: the instrument floors a zero-coverage answer at 1, which is what it was written to do, and the 2 was a labelling mistake against our own spec. idx-11 tests the keyword cap on an answer that does cover ground.",
    answer:
      "This is a classic query optimization scenario. I would leverage a holistic approach to index strategy, taking into account cardinality, selectivity, the query planner, statistics, partitioning, and the overall access pattern. Modern Postgres offers a rich set of primitives here, including B-tree, GIN, GiST and BRIN, and the right choice depends on the workload profile. I would also consider connection pooling, vacuum tuning, and the buffer cache hit ratio as part of a comprehensive performance posture. Ultimately the goal is to align the physical design with the logical access pattern to deliver optimal throughput at scale.",
  },
  {
    ...INDEX_QUESTION,
    id: "idx-8-confident-wrong",
    expectedBand: 3,
    language: "en",
    note: "Well structured and partly right, but asserts something false with no hedge. The misconception cap must bite.",
    answer:
      "The goal is to avoid scanning the whole table, so I would look at the plan first and then index the two filtered columns. The important thing with a composite index is that column order does not matter in Postgres, since the planner will reorder the predicates for you anyway, so you can put them in any order and get the same seek. I would add the index and then re-run EXPLAIN to confirm it switched to an index scan. You do pay for it on writes, since every insert has to update the index too, and on a large table that is worth measuring before you ship it.",
  },
  {
    ...INDEX_QUESTION,
    id: "idx-9-broad-flat",
    expectedBand: 1,
    language: "en",
    note: "Names MORE things than the mid answer and is longer, but every item is one clause deep, nothing is integrated, and nothing is actually addressed. Label corrected from 2 to 1 for the same reason as idx-7: naming a rubric topic in a list of ten is not covering it, and zero coverage floors at 1. The property under test is unchanged and still holds: broad and flat must lose to narrow and deep (idx-10).",
    answer:
      "There are a lot of angles here. You can look at the query plan. You can add an index. You can partition the table. You can tune work_mem. You can check for bloat and run vacuum. You can look at connection pooling. You can add a read replica. You can cache the result in Redis. You can denormalize the table. You can upgrade the hardware. Any of these could help depending on the situation, so I would work through them and see which one makes the biggest difference.",
  },
  {
    ...INDEX_QUESTION,
    id: "idx-10-narrow-deep",
    expectedBand: 4,
    language: "en",
    note: "Answers only one slice, says so, and goes deep in it. Declared scope plus mechanism plus a decision should beat the broad and flat answer above.",
    answer:
      "I will take only the index design part and assume the plan already showed a sequential scan. The thing that decides everything here is the order of the columns in the composite index. Postgres can only seek on a prefix of the index, so if the first column is the low selectivity one, the index still has to scan a huge range before the second predicate can filter it. So I would put the high selectivity equality column first and the range predicate last, because everything after a range in the key is only usable as a filter, not as a seek. That is the choice I would make. There is more to say about write cost and partial indexes but that is the part that actually decides whether the index gets used.",
  },

  {
    ...INDEX_QUESTION,
    id: "idx-11-salad-with-coverage",
    expectedBand: 2,
    language: "en",
    note: "Added after the first gate run. Real vocabulary and real rubric coverage, but no mechanism anywhere and no quantity: the terms are apposed to nouns rather than doing any work. This is the case the keyword cap exists for, since the coverage floor cannot reach it.",
    answer:
      "I would review the query plan to understand the execution strategy, then evaluate index candidates against the predicates in the WHERE clause. The right index depends on cardinality and selectivity considerations. I would also weigh the write path implications, since indexes carry a maintenance cost on insert and update, and index size is a factor on a table of this magnitude. Statistics freshness is another dimension worth attention. Overall it is a matter of aligning the physical design with the access pattern.",
  },

  // ---- React re-render question -------------------------------------------
  {
    ...RERENDER_QUESTION,
    id: "rr-1-novice",
    expectedBand: 1,
    language: "en",
    note: "Restates the symptom, no mechanism, offers a cargo-cult rule.",
    answer:
      "React re-renders when state changes. You should wrap the list in React.memo, that usually fixes re-render problems. I think memo stops the component from rendering again.",
  },
  {
    ...RERENDER_QUESTION,
    id: "rr-2-junior",
    expectedBand: 2,
    language: "en",
    note: "Correct steps, correct terms, listed without an integrating why.",
    answer:
      "The input has state in a parent component. When you type, setState runs and the parent re-renders. Because the list is a child of the parent, the list re-renders too. You can wrap the list in React.memo. You can also use useCallback for the handlers and useMemo for the data. Then it should stop re-rendering on every keystroke.",
  },
  {
    ...RERENDER_QUESTION,
    id: "rr-3-mid",
    expectedBand: 3,
    language: "en",
    note: "Names the real mechanism and chains it, but stops without deciding between the fixes the question invited.",
    answer:
      "The reason is that state lives in a shared parent, so a keystroke updates that parent and React re-renders its whole subtree, and the list is in that subtree. People add React.memo and are surprised it does nothing, and the reason is usually that one of the props is created fresh on every render, so the memo comparison sees a new reference every time and bails out. A new array literal or an inline arrow function is enough to do it. So the options are to stabilize those identities, or to move the input and its state down into its own component so the list is not in the re-rendering subtree at all.",
  },
  {
    ...RERENDER_QUESTION,
    id: "rr-4-senior",
    expectedBand: 5,
    language: "en",
    note: "Scopes it, rejects the memo path with a reason, commits to moving state down, gives a detection signal, and says when not to bother.",
    answer:
      "First, I would check whether it actually matters. If the list is 20 rows, a re-render is under a millisecond and this is not a bug, it is just something visible in the profiler. Assuming the list is large enough to matter, the cause is that the input's state sits in a component that also owns the list, so every keystroke re-renders that subtree. I would not fix this with React.memo and useCallback. That path works but it spreads the fix across every prop and it silently breaks the first time someone adds an inline object, and you will not notice because nothing errors, it just gets slow again. Instead I would move the input and its state into its own component, so the state change is contained where the state lives. That is a structural fix that cannot regress from someone adding a prop. To confirm it worked I would use the React Profiler and look at what commits on a keystroke, not at the frame rate, because the frame rate will look fine right up until the list gets big.",
  },

  // ---- Definition question, the affordance gate ---------------------------
  {
    ...CACHING_QUESTION,
    id: "cache-1-novice",
    expectedBand: 1,
    language: "en",
    note: "A definition restated with nothing behind it.",
    answer: "HTTP caching is when the browser saves things so the website loads faster next time.",
  },
  {
    ...CACHING_QUESTION,
    id: "cache-2-junior",
    expectedBand: 2,
    language: "en",
    note: "Several correct pieces, listed, not integrated.",
    answer:
      "HTTP caching stores responses. The browser has a cache. There are headers like Cache-Control and ETag. Cache-Control can set max-age. ETag is used for validation. There are also CDNs which cache responses closer to the user.",
  },
  {
    ...CACHING_QUESTION,
    id: "cache-3-mechanism-no-tradeoff",
    expectedBand: 4,
    language: "en",
    note: "THE AFFORDANCE TEST. Strong mechanical explanation with no trade-off and no decision, on a question that could not invite one. Must NOT be capped at 3. If this reads as 3, the affordance gate is not working.",
    answer:
      "The purpose is to avoid asking for something you already have. A cache stores a response along with the rules for reusing it, and every later request for that resource is decided against those rules rather than by going to the server. The first rule is freshness: the response carries a lifetime, usually max-age, and while it is inside that window the cache can serve it without contacting anyone at all, which is why a fresh hit costs zero network. Once it expires the response is not thrown away, it becomes stale, and the cache revalidates by sending the ETag back in an If-None-Match header. If nothing changed the server answers 304 with no body, so you still pay a round trip but not the payload. That two-stage design is the whole point: fresh means no request, stale means a cheap request. And this happens at every hop that speaks HTTP, so the browser, any proxy, and a CDN each hold their own copy under the same rules, which is why the same headers control all of them.",
  },

  // ---- Arabic, same instrument -------------------------------------------
  {
    ...INDEX_QUESTION,
    id: "idx-ar-1-novice",
    expectedBand: 1,
    language: "ar",
    note: "Arabic novice: one remembered fact, no mechanism. Must read the same as its English twin.",
    answer:
      "أظن لازم نضيف index. الـ index بيخلي الـ query أسرع. مش متأكد كيف بالظبط بس عادة لما نضيف index على الأعمدة بتنحل المشكلة.",
  },
  {
    ...INDEX_QUESTION,
    id: "idx-ar-2-junior",
    expectedBand: 2,
    language: "ar",
    note: "Arabic junior: correct steps listed, never integrated.",
    answer:
      "أول شي بشغل EXPLAIN عالـ query لأشوف الـ plan. بعدين بضيف index على العمودين اللي بالـ WHERE. بعدها بشغل ANALYZE عشان الإحصائيات تكون محدثة. وبعدين بجرب الـ query مرة تانية وبشوف إذا صار أسرع. إذا لسا بطيء بشوف إذا بقدر أعيد كتابة الـ query.",
  },
  {
    ...INDEX_QUESTION,
    id: "idx-ar-3-senior",
    expectedBand: 5,
    language: "ar",
    note: "Arabic senior: scope, rejected alternative with a reason, a decision, quantities, a failure mode with a detection signal. The Arabic set must reproduce the English ordering.",
    answer:
      "بفترض إنه ده مسار OLTP مش تقرير ليلي، لأن الجواب بيتغير كليا لو كان تقرير. ببدأ بـ EXPLAIN ANALYZE مش الـ plan المتوقع، لأني بدي أعداد الصفوف الحقيقية وبدي أعرف إذا بينزل عالقرص. على 50 مليون صف الـ sequential scan بيكلف ثواني من الـ IO لحاله، فإذا الـ plan بيقول seq scan فالحل هو مسار وصول جديد مش إعادة كتابة الـ query. بالـ composite index ترتيب الأعمدة هو اللي بيقرر: العمود الأكثر تحديدا بيجي أول، وإذا في شرط range بيجي آخر شي، لأن كل اللي بعد الـ range بالـ index بيصير غير قابل للـ seek. ما بروح على covering index مع INCLUDE هون رغم إنه بيوفر قراءة الـ heap، لأن الجدول 50 مليون صف وكل عمود زيادة بيكبر الـ index على جدول كتابته عالية. التكلفة اللي بدي أراقبها هي write amplification، وبتظهر كارتفاع بزمن الـ commit مع CPU ثابت. بس قبل ما أثبت ترتيب الأعمدة بدي أشوف pg_stats وأعرف n_distinct الحقيقي بدل ما أخمن.",
  },
];

// Ranked pairs are the release gate. A single labeller can reliably say "this
// answer is stronger than that one" even where the exact band is arguable, so
// ordering is asserted on pairs and exact agreement is only reported.
export function rankedPairs(): Array<{ stronger: GoldenItem; weaker: GoldenItem }> {
  const pairs: Array<{ stronger: GoldenItem; weaker: GoldenItem }> = [];
  for (const a of GOLDEN_ANSWERS) {
    for (const b of GOLDEN_ANSWERS) {
      if (a.question !== b.question) continue;
      if (a.language !== b.language) continue;
      if (a.expectedBand - b.expectedBand >= 2) pairs.push({ stronger: a, weaker: b });
    }
  }
  return pairs;
}
