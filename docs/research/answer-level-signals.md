# What a written answer reveals about level

Research basis for the scanning agent. This file is the measurement spec: it says what we look for in an answer, why that signal is defensible, and how signals become a level. The plan that consumes it is `docs/PLAN-v2.md`.

Every claim below is tagged `Confirmed` (primary source, link given), `Likely` (repeated pattern across sources), or `Assessment` (our judgment).

---

## 0. The honest accuracy target

The request was 90 to 98 percent accuracy. That number is not reachable as *exact* level agreement, and any product claiming it is measuring something else.

- `Confirmed` Two trained human raters on one essay prompt agree at Pearson ~0.75; the operational industry standard for machine scoring is QWK >= 0.70, and machine agreement may not be more than 0.10 below human-human agreement ([Williamson, Xi & Breyer guidelines](https://files.eric.ed.gov/fulltext/ED615602.pdf)).
- `Confirmed` ETS e-rater on TOEFL independent prompts: QWK 0.69, Pearson 0.74 over 152,000+ responses ([ETS](https://files.eric.ed.gov/fulltext/EJ1109838.pdf)).
- `Confirmed` MT-Bench human-human agreement is 81 percent; GPT-4 judge agreement with humans is at the same level, not above it ([arXiv:2306.05685](https://arxiv.org/abs/2306.05685)).
- `Confirmed` Short-answer scoring is harder than essay scoring: mean QWK 0.34 to 0.41 versus 0.42 to 0.43 ([arXiv:2603.10233](https://arxiv.org/html/2603.10233)).

**The reachable target, and the one we commit to:**

| Metric | Target | Meaning |
| --- | --- | --- |
| Adjacent-band accuracy | **>= 92 percent** | We are almost never more than one band off. This is the honest reading of "90 to 98 percent". |
| Exact-band accuracy | 65 to 80 percent | Comparable to two human experts placing the same candidate. |
| QWK vs expert labels | **>= 0.70** | The industry floor for operational machine scoring. |
| Ordering | **100 percent** on the golden set | A senior answer must never score below a junior answer. Non-negotiable. |
| Reported output | Band **plus** interval, plus a "not assessed" state | A point estimate with no interval is the thing every competitor gets wrong. |

`Assessment` The way to hit the spirit of 90 to 98 percent is not a better prompt. It is (a) never claiming more precision than we have, (b) refusing to score thin evidence, and (c) making the *ordering* perfect even when the *point* is fuzzy.

---

## 1. The core finding: level lives in the shape of the answer, not the topic

`Confirmed` Chi, Feltovich & Glaser (1981): experts sorted physics problems by the governing principle (conservation of energy); novices sorted by surface features (inclined plane, pulley). Expertise is deep-structure categorization, not vocabulary ([Cognitive Science 5:121-152](https://onlinelibrary.wiley.com/doi/10.1207/s15516709cog0502_2)).

`Confirmed` Expert knowledge is **conditionalized**: it "includes a specification of the contexts in which it is useful". Knowledge that cannot say when it applies is inert ([How People Learn, ch.2](https://www.nationalacademies.org/read/9853/chapter/5)).

`Confirmed` Lister et al. (2006) asked people to explain a Java loop in plain English. 7 of 8 educators gave a **relational** answer (stated the code's purpose). Of 108 students, about 33 percent were relational and about 50 percent were **multistructural**, a correct line-by-line walk with no integrating statement ([ITiCSE'06](https://dl.acm.org/doi/pdf/10.1145/1140123.1140157)).

`Confirmed` Gartmeier et al.: **negative knowledge**, knowing what goes wrong and what not to do, is a distinct component of professional expertise built from reflection on real errors ([ERIC EJ1071816](https://eric.ed.gov/?id=EJ1071816)).

`Confirmed` Hyland (1995): hedging is *dense in expert* scientific prose, 20.9 per 1,000 words, peaking at 36.4 in Discussion sections. The expert hedges are strategic: they reference limiting experimental conditions, a model or method, or an explicit admission of missing data. Novices "lack a complete repertoire" and misuse hedges ([ERIC ED390258](https://files.eric.ed.gov/fulltext/ED390258.pdf)).

`Confirmed` Atir, Rosenzweig & Dunning (2015): self-perceived expertise predicts claiming familiarity with terms that do not exist; 92 percent claimed familiarity with fabricated biology terms. Fluent terminology is decoupled from knowledge ([Psych Science](https://journals.sagepub.com/doi/abs/10.1177/0956797615588195)).

`Confirmed` Industry says the same thing in its own words. levels.fyi: the three axes that appear in nearly every ladder are **ambiguity, scope, impact** ([levels.fyi](https://www.levels.fyi/blog/swe-level-framework.html)). Monzo L5: "Delegates technical decisions with low risk and high reversibility. Owns technical decisions with high risk and low reversibility" ([Monzo framework](https://github.com/monzo/progression-framework/blob/master/frameworks/engineering/backend.md)). Hello Interview on system design: mid is "not required to actively spot problems", senior must "proactively recognize some limitations in their own design", and staff "makes the decision, does not outline options" ([Hello Interview](https://www.hellointerview.com/blog/the-system-design-interview-what-is-expected-at-each-level)).

**The one-line conclusion:** term density, length, and fluency are near-worthless. Structure, conditionality, mechanism, failure awareness, concreteness, and calibrated uncertainty carry almost all the level signal.

---

## 2. The instrument: seven axes

The scanning agent never guesses a level. It extracts **binary, quote-grounded observations** on seven axes. Deterministic code turns observations into a band. Each observation must carry an exact substring from the answer, mechanically verified, or it does not count.

### Axis A. Structure (SOLO)
Source: Biggs & Collis via Lister et al.

| Code | Name | Observable |
| --- | --- | --- |
| A0 | Prestructural | Misses the point, restates the question, or answers a different surface-similar question |
| A1 | Unistructural | One relevant point, nothing connected to it |
| A2 | Multistructural | Several correct pieces, listed, never integrated. This is the "answered 50 percent" shape |
| A3 | Relational | States the purpose or governing principle and ties the pieces to it |
| A4 | Extended abstract | Generalizes past the question, reframes it, or challenges its premise |

### Axis B. Mechanism depth
Source: Russ et al. (2008) mechanistic reasoning checklist ([Science Education 92:499-525](https://onlinelibrary.wiley.com/doi/10.1002/sce.20264)).

- B1 names entities that actually do something (not just nouns)
- B2 states an activity, what the entity does, with a mechanism verb
- B3 chains cause at least two links deep
- B4 states an invariant ("the sum of X never exceeds Y")
- B5 gives a cost model as a function of a variable (time, memory, network, money)
- B6 reasons counterfactually ("remove the index and this becomes a sequential scan")

`Assessment` Novices produce temporal connectives (then, next). Mechanism producers use causal ones (because, therefore, which means, otherwise) between two technical claims.

### Axis C. Conditionality and decision
Source: conditionalized knowledge (How People Learn), Hello Interview, Monzo, Tech Interview Handbook.

- C1 states assumptions or scopes the answer before answering
- C2 asks for, or names, a missing constraint
- C3 names at least one real alternative
- C4 **rejects** an alternative with a stated reason
- C5 makes an actual decision instead of listing options
- C6 gives a decision procedure ("depends on X; if X then A, else B")
- C7 frames reversibility or risk ("this is a one-way door, so...")

`Confirmed` "Options listed with no decision" is a named anti-signal in interviewing.io's guidance and in the Hello Interview staff bar. `Confirmed` Requirements and prioritization is "the number one most common feedback given to mid-level" candidates ([Hello Interview delivery](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery)).

### Axis D. Failure and negative knowledge
Source: Gartmeier negative knowledge, Lister extended-abstract example, Monzo L3 mastery.

- D1 names a failure mode or edge case
- D2 states a limit or breaking point ("above roughly 50 GB this stops working")
- D3 gives a detection signal ("you would see rising p99 with flat CPU")
- D4 names recovery, rollback, or blast radius
- D5 states when **not** to use its own recommendation
- D6 unprompted, that is the question did not ask for it

`Assessment` D5 and D6 together are the single strongest senior discriminator we have. The one-line check: *does the answer name a condition under which its own recommendation is wrong?*

### Axis E. Concreteness
- E1 a quantity with a unit ("p99 about 40 ms", "roughly 2 KB per row", "3 round trips")
- E2 a specific artifact: version, flag, config key, API or method name, error string
- E3 a named failure-mode term of art (thundering herd, N+1, write amplification, split brain)
- E4 a concrete first-person incident with specifics, not a generic claim of experience

`Confirmed` Length correlates 0.61 to 0.80 with human essay scores, which is exactly why length must be excluded and concreteness measured instead ([PMC8460059](https://pmc.ncbi.nlm.nih.gov/articles/PMC8460059/)).

### Axis F. Epistemic calibration
Source: Hyland 1995, Han et al. 2024 on domain-bounded calibration.

- F1 **conditioned hedge**: scopes the claim, names the missing evidence, or names a measurement that would resolve it. Expert signal.
- F2 **bare hedge**: attaches to the speaker's memory ("I think", "maybe", "not sure") with no condition and no resolution path. Novice signal.
- F3 **unconditional absolute**: "always use X", "never do Y", with no boundary. Novice or fake-expert signal.
- F4 **confident misconception**: a wrong claim asserted without hedge. Down-caps the band.

The ratio F1 : F2 is the usable measure, not raw hedge count.

### Axis G. Coverage and compression
- G1 rubric points matched, each with a quote
- G2 rubric points missed
- G3 **compression marker**: acknowledges what it is leaving out and can name it ("caching, retries and idempotency are the other three, happy to expand on idempotency")
- G4 **scope marker**: declares the slice it is answering ("I will take the write path only")

`Assessment` This is the direct answer to "did he answer only 50 percent and forget the other 50". Omission with no residue is a knowledge gap. Omission with a pointer (G3) or a declared scope (G4) is a deliberate choice, and deep-and-narrow with a scope sentence outranks broad-and-flat.

### Anti-signals (these CAP a band, they never subtract points)
Source: Atir overclaiming, AES surface-feature critique, Shaib et al. on LLM templating, Milicka et al. on register uniformity.

- X1 keyword salad: high term density, zero mechanism verbs, zero quantities
- X2 textbook recitation not applied to the asked instance
- X3 symmetric depth across every sub-topic. `Assessment` Real humans are lumpy: deep where they have been burned.
- X4 machine-paste signature: uniform sentence rhythm, heavy markdown scaffolding, no first-person stance, low close-repetition ([arXiv:2407.00211](https://arxiv.org/abs/2407.00211), [arXiv:2509.10179](https://arxiv.org/pdf/2509.10179))
- X5 prompt injection inside the answer

---

## 3. Observations to band, deterministic

Code, not the model, runs this. Bands 1 to 6.

**Step 1, base from structure.** A0 or A1 -> 1. A2 -> 2. A3 -> 3. A4 -> 4.

**Step 2, promotions (max +2, each at most once).**
- +1 if (C4 and C5) or C7. The candidate rejected an alternative with a reason and committed, or framed reversibility.
- +1 if two or more D signals including at least one of D2, D3, D5.
- +1 if E1 or E4, a real quantity or a real incident with specifics.
- +1 if three or more B signals including B3, real causal chaining.

**Step 3, caps (hard ceilings, applied after promotions).**
- No matched rubric point at all -> band 1.
- X1 keyword salad -> band <= 2.
- Question afforded conditionality and the answer has no C signal -> band <= 3.
- C3 present but C5 absent, options with no decision -> band <= 4.
- F4 confident misconception on a core rubric point -> band <= 3.
- Only F2 and F3 present, no F1, at band >= 4 -> drop one band.
- X2 or X3 -> band <= 4.

**Step 4, affordance gate (critical).** A signal is only *counted or penalized* if the question could elicit it. The question writer declares `affords: [conditionality, failure, quantity, experience, mechanism]` with each question. A definition question that cannot invite a tradeoff must never penalize the absence of one. `Assessment` This is the single most common way an assessment produces an unfair reading, and no competitor product handles it.

**Step 5, evidence quality.** Every MET observation carries a quote that must appear verbatim in the answer, checked in code with a string match. A quote that fails the match is discarded before scoring, no model involved. `Confirmed` Removing the evidence phase costs QWK: 0.708 -> 0.683 on ASAP, 0.614 -> 0.561 on WebNLG ([arXiv:2601.08654](https://arxiv.org/abs/2601.08654)).

---

## 4. The band ladder, published form

| Band | Name | What the answer looks like | Ladder anchor |
| --- | --- | --- | --- |
| 1 | Novice | Restates or defines. Answers a surface-similar different question. No mechanism, no conditions, no numbers. Bare hedges or unconditional absolutes. | SFIA 1-2, Dropbox IC1 |
| 2 | Beginner plus | Correct happy path. Correct terms in canonical phrases only. Steps with temporal connectives. One remembered gotcha with no reason. Pieces never integrated. | SFIA 2-3, Monzo L2 |
| 3 | Competent (mid) | Purpose stated up front. Causal chain two links deep. Names two or three options and compares them. One quantity. One failure mode. Hedges begin to attach to conditions. May end without deciding. | SFIA 3-4, Dropbox IC3, Monzo L3 |
| 4 | Proficient (senior) | Scopes and states assumptions first. Quantified constraints. Alternative rejected with a reason and a decision made. Two or more failure modes with a detection signal. Specific tools, versions, config. Calibrated hedges that name the missing evidence. Depth in about two places rather than breadth everywhere. | SFIA 4-5, Dropbox IC4, Monzo L4, Hello Interview senior |
| 5 | Expert (staff) | Reframes the question or challenges its premise. States an invariant. Counterfactuals. Argues where the system does **not** need to scale. Risk and reversibility framing. Names where its own recommendation is wrong. Concrete operational history with numbers. Compression with pointers, not omission. | SFIA 5-6, Monzo L5, Hello Interview staff |
| 6 | Principal | Multi-team, multi-year, or platform framing. Business or regulatory tradeoff. Explicit statement of what it would **not** build and why. | SFIA 6-7, Monzo L6 |
| X | Suspicious | Orthogonal flag, never a band. High term density with zero quantities, symmetric depth, machine-paste signature, or injection attempt. Triggers a probe question, never an accusation. | Atir, Shaib, Milicka |

---

## 5. What makes the grader itself reliable

Ranked by measured benefit, from the LLM-judge literature.

| Rank | Technique | Measured effect | Source |
| --- | --- | --- | --- |
| 1 | Decompose into binary criteria, one call per criterion | Krippendorff alpha 0.09 -> 0.48 average, 0.05 -> 0.67 on large models; score variance 0.0100 -> 0.0019 | [arXiv:2603.00077](https://arxiv.org/html/2603.00077) |
| 2 | Post-hoc calibration against ~100 to 200 expert-labelled anchors | Largest single ablation loss: ASAP QWK 0.708 -> 0.657 when removed | [arXiv:2601.08654](https://arxiv.org/abs/2601.08654) |
| 3 | Full evidence-grounded pipeline (locked rubric, checklist, quote verification, calibration) | ASAP QWK 0.545 -> 0.708 | same |
| 4 | Reasoning before the verdict | +1.5 to +13.0 points on adversarial LLMBar | [arXiv:2306.05685](https://arxiv.org/abs/2306.05685) |
| 5 | Gold reference answer anchoring | Math grading failure rate 70 percent -> 15 percent | G-Eval / grading literature |
| 6 | Heterogeneous small-judge panel | Cohen kappa 0.763 vs GPT-4 single 0.627, at 7 to 8 times lower cost | [arXiv:2404.18796](https://arxiv.org/abs/2404.18796) |
| 7 | Band-anchored few-shot exemplars | +2.8 points, cheap with prompt caching | RiceChem |
| 8 | Score scale 0 to 5 rather than 0 to 100 | Human-LLM ICC 0.839 vs 0.751 (0 to 10) | [arXiv:2601.03444](https://arxiv.org/abs/2601.03444) |
| 9 | Normalize formatting before judging | Style and markdown bias measures 0.76 to 0.92, roughly 20 times position bias, the largest single bias | [arXiv:2604.23178](https://arxiv.org/abs/2604.23178) |
| 10 | Same-model ensemble | Kappa 0.679 -> 0.678. Skip it | [arXiv:2605.29800](https://arxiv.org/abs/2605.29800) |

Additional hard facts we design around:

- `Confirmed` Temperature 0 is **not** deterministic. Flip rate drops from 13.3 percent to 2.8 percent, not to zero; some items still flip 50 percent of the time ([arXiv:2606.13685](https://arxiv.org/abs/2606.13685)). So: repeat borderline items, and abstain above a flip-rate threshold.
- `Confirmed` A panel of 9 frontier judges provides only 2.18 effective independent votes. The best single judge matched or beat the full panel on all three datasets ([arXiv:2605.29800](https://arxiv.org/abs/2605.29800)). So: no big ensembles. One good extractor plus one adversarial verifier.
- `Confirmed` Adversarial debate hurts generation but helps **error detection**, +27.4 points F1 ([arXiv:2606.02866](https://arxiv.org/abs/2606.02866)). So: the verifier is a gate that can only lower a grade or force abstention, never raise it.
- `Confirmed` Claude Sonnet 4.6 was the most injection-resistant grader tested, ASR 0.033 on DAN-style attacks ([arXiv:2606.03090](https://arxiv.org/abs/2606.03090)). Relevant since this project runs on the Claude CLI.
- `Confirmed` Judges show a leniency drift of about +0.170 while ranking stays intact. So: monitor mean assigned band on a frozen golden set, not just correlation.

---

## 6. Anti-gaming: what works, what is theater

`Confirmed` AI-text detection is theater. Stanford measured 61 percent accuracy with a 26 percent false-positive rate against non-native English writers ([arXiv:2304.02819](https://arxiv.org/pdf/2304.02819)). DetectGPT falls from 70.3 percent to 4.6 percent after basic paraphrasing. `Assessment` At 12 questions per session and a 2 percent false-positive rate, roughly a quarter of honest candidates would collect at least one false flag. **We will never gate a score on a detector and never accuse a user.**

What actually works, in our order of adoption:

1. **Probe their own words.** Quote a phrase from their previous answer and ask them to expand it. A pasted answer cannot survive two rounds of this. It is also good assessment regardless of cheating.
2. **Personal-experience anchoring.** "Describe a time in your own work when this broke." Grade the specificity of the incident, not its correctness.
3. **Time-box as a validity filter only.** `Confirmed` Rapid-guessing thresholds sit at 10 to 20 percent of an item's median response time ([Wise](https://onlinelibrary.wiley.com/doi/10.1111/emip.12165)). A 400-word answer submitted 8 seconds after render is not typed. This flags validity; it **never** enters the ability estimate. `Confirmed` van der Linden models speed as a latent trait separate from ability; ADA extended-time accommodation and Arabic typing speed make timing an unfair ability input.
4. **Internal consistency.** A band-5 answer followed by band-1 answers on adjacent probes is a statistical flag with no detector involved.
5. **Say the quiet part out loud.** This is a self-assessment. Cheating yourself produces a useless report. That framing is a structural advantage worth stating in the UI instead of building detection theater.

---

## 7. Validity traps we must design against

- `Confirmed` Verbosity: essay length correlates 0.61 to 0.80 with human scores. Mitigation: length is not an input; concreteness (Axis E) is.
- `Confirmed` Low-stakes motivation: motivated examinees outperform unmotivated by d = 0.59, over half a standard deviation ([Wise & DeMars](https://commons.lib.jmu.edu/gradpsych/13/)). Mitigation: keep the session short (10 to 14 items), show progress, and report a band with an interval rather than a false-precision number.
- `Likely` Fluency and demographic bias: GPT-4o assigned systematically different scores to identical-quality essays across groups ([arXiv:2603.18765](https://arxiv.org/pdf/2603.18765)). Mitigation: every axis is language-portable (mechanism, numbers, conditionality survive translation), plus an Arabic golden set with the same band ordering.
- `Confirmed` Automated item generation without pretesting is unreliable: items from the same family with different incidentals differ significantly in difficulty, so "true psychometric equivalence of isomorphs cannot be assumed" ([PMC10496230](https://pmc.ncbi.nlm.nih.gov/articles/PMC10496230/)). Mitigation: the generator's asserted difficulty is a **prior with a wide standard deviation, not a fact**, and item difficulty is updated from responses.

---

## 8. Sources

Expertise and cognition: [Chi, Feltovich & Glaser 1981](https://onlinelibrary.wiley.com/doi/10.1207/s15516709cog0502_2) · [How People Learn ch.2](https://www.nationalacademies.org/read/9853/chapter/5) · [Chi et al. 1989 self-explanation](https://onlinelibrary.wiley.com/doi/abs/10.1207/s15516709cog1302_1) · [Lister et al. 2006](https://dl.acm.org/doi/pdf/10.1145/1140123.1140157) · [Russ et al. 2008](https://onlinelibrary.wiley.com/doi/10.1002/sce.20264) · [Gartmeier negative knowledge](https://eric.ed.gov/?id=EJ1071816) · [Hyland 1995 hedging](https://files.eric.ed.gov/fulltext/ED390258.pdf) · [Atir, Rosenzweig & Dunning 2015](https://journals.sagepub.com/doi/abs/10.1177/0956797615588195) · [Han et al. 2024 calibration](https://onlinelibrary.wiley.com/doi/10.1002/bdm.2375)

Industry leveling: [SFIA 9](https://sfia-online.org/en/sfia-9/responsibilities) · [Dropbox career framework](https://dropbox.github.io/dbx-career-framework/ic4_software_engineer.html) · [Monzo progression framework](https://github.com/monzo/progression-framework/blob/master/frameworks/engineering/backend.md) · [engineeringladders](https://github.com/jorgef/engineeringladders) · [levels.fyi framework](https://www.levels.fyi/blog/swe-level-framework.html) · [Hello Interview level expectations](https://www.hellointerview.com/blog/the-system-design-interview-what-is-expected-at-each-level) · [Hello Interview staff bar](https://www.hellointerview.com/blog/staff-level-system-design) · [Tech Interview Handbook rubrics](https://www.techinterviewhandbook.org/coding-interview-rubrics/) · [Karat measurement](https://karat.com/what-do-karat-technical-interviews-measure/) · [Google re:Work structured interviewing](https://rework.withgoogle.com/intl/en/guides/a-guide-to-structured-interviewing-for-better-hiring-practices)

Measurement: [Glicko-2 spec](http://www.glicko.net/glicko/glicko2.pdf) · [Elo in education, Vermeiren 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12682724/) · [Hofman 2020 on Elo limits](https://pmc.ncbi.nlm.nih.gov/articles/PMC7151223/) · [item selection and exposure control](https://pmc.ncbi.nlm.nih.gov/articles/PMC5968224/) · [stopping rules under GPCM](https://pmc.ncbi.nlm.nih.gov/articles/PMC7518406/) · [PROMIS CAT stopping](https://www.healthmeasures.net/explore-measurement-systems/promis/intro-to-promis/differences-between-promis-measures) · [Williamson, Xi & Breyer AES guidelines](https://files.eric.ed.gov/fulltext/ED615602.pdf) · [ETS e-rater](https://files.eric.ed.gov/fulltext/EJ1109838.pdf) · [AIG isomorph difficulty](https://pmc.ncbi.nlm.nih.gov/articles/PMC10496230/)

LLM judges: [MT-Bench](https://arxiv.org/abs/2306.05685) · [criterion decomposition](https://arxiv.org/html/2603.00077) · [Rulers calibration](https://arxiv.org/abs/2601.08654) · [bias re-measurement 2026](https://arxiv.org/abs/2604.23178) · [t=0 non-determinism](https://arxiv.org/abs/2606.13685) · [judge panel effective votes](https://arxiv.org/abs/2605.29800) · [debate for error detection](https://arxiv.org/abs/2606.02866) · [autograder injection](https://arxiv.org/abs/2606.03090) · [PoLL panel](https://arxiv.org/abs/2404.18796) · [score scale ICC](https://arxiv.org/abs/2601.03444)

Detection and fairness: [detector bias against non-native writers](https://arxiv.org/pdf/2304.02819) · [LLM syntactic templates](https://arxiv.org/abs/2407.00211) · [register uniformity](https://arxiv.org/pdf/2509.10179) · [rapid-guessing thresholds](https://onlinelibrary.wiley.com/doi/10.1111/emip.12165) · [low-stakes motivation](https://commons.lib.jmu.edu/gradpsych/13/) · [length bias in AES](https://pmc.ncbi.nlm.nih.gov/articles/PMC8460059/)

Market: [Pluralsight adaptive assessments](https://www.pluralsight.com/content/dam/pluralsight2/product/iris/AdaptiveAssessments_af_v1.pdf) · [Duolingo English Test technical manual](https://duolingo-papers.s3.amazonaws.com/other/technical_manual/DET_technical_manual_2025_07.pdf) · [Karat acquires Byteboard](https://karat.com/karat-acquires-byteboard/) · [Triplebyte postmortem](https://www.otherbranch.com/shared/blog/why-triplebyte-failed) · [why platforms cannot detect ChatGPT](https://www.hatchways.io/blog/why-platforms-like-codesignal-and-hackerrank-cant-and-shouldnt-detect-chatgpt-cheating)
