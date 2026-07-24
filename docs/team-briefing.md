# Dynamic Wizard Questions - Team Briefing

A complete walkthrough of the product for a team presentation: what it is, how the workflow runs, every AI agent and its job, the JSON contracts, how the logs work (for a live demo), the API, the database, the CLI runner, and the token/cost model.

---

## 1. What the product is

Dynamic Wizard Questions is an adaptive AI skill assessment. A candidate picks a role (for example "Backend Engineer"), answers exactly 25 questions, and receives a professional report with a score out of 1000, split across the skill topics that matter for that role.

The exam adapts in real time:

- Question 1 is the ONLY written (free-text) question. It is a templated warm-up, and the AI grades the answer for DEPTH. A deep answer jumps the starting ability estimate several levels at once; a shallow answer barely moves it.
- Questions 2 to 25 are multiple-choice questions (MCQs) served instantly from a pre-generated bank. Each answer moves the difficulty up or down like a staircase. Ability carries across topics, so a strong candidate is never reset to beginner questions when a new topic opens.
- The final report gives a verdict, per-topic strengths and gaps, ranked weak points, and a learning path. It persists at a permalink URL: /report/[id].

The product supports English and Arabic end to end (all 10 preset roles have pre-seeded question banks in both languages, 710 MCQs total).

## 2. The one design principle

**AI agents do only the fuzzy language work. Deterministic code owns every number.**

- Agents take text in and return validated JSON out. Nothing else.
- The ability estimate (theta), the next-question choice, the difficulty staircase, MCQ scoring, option shuffling, and the 1000-point score all live in pure TypeScript code under `src/core/`, fully unit tested, with zero I/O.
- An LLM never carries numeric state across turns. This is why the score is trustworthy and reproducible.

## 3. Technology stack

- Next.js 16 (App Router) + React 19 + TypeScript strict mode.
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`): spawns the local `claude` CLI as a child process. Runs on the personal Claude subscription. There is NO API key: the code deletes `ANTHROPIC_API_KEY` from the child environment so calls can never bill a pay-per-token key.
- Prisma 7 + SQLite (single-user local for v1) via the better-sqlite3 driver adapter.
- Zod 4: every agent output has a strict schema contract.
- Langfuse: optional, non-blocking observability. Every AI call of one assessment is grouped under one Langfuse session.
- Vitest: unit tests for the deterministic engine.

## 4. The five AI agents

Every agent is a one-shot call: system prompt + user prompt in, one validated JSON object out. All tools (file access, shell, web) are hard-disabled for every agent. Each agent's name is also its Langfuse trace label, so logs read at a glance.

| Agent | Model | Job | Max output tokens | Cost guard | Timeout |
|---|---|---|---|---|---|
| topicPlanner (trace: topic-planner) | Haiku | Reads the role + specialization and structures it into 3 to 8 weighted skill topics (the "blueprint") | 4,000 | $0.50 | 120s |
| questionWriter (trace: question-writer) | Haiku | Writes one question with a rubric and a gold answer. Rarely used in the shipped flow (fallback path) | 2,000 | $0.30 | 120s |
| answerGrader (trace: answer-grader) | Sonnet | The critical path: grades the written warm-up answer against the rubric. This grade drives the ability jump | 6,000 | $1.00 | 120s |
| reportWriter (trace: report-writer) | Sonnet | Runs once at the end: turns the transcript + computed scores into the verdict, weak points, and learning path | 6,000 | $0.70 | 240s |
| mcqWriter (trace: mcq-writer) | Haiku | Batch-generates the whole MCQ pool for a session in one background call, so every exam round is pure database work | 8,000 | $0.60 | 240s |

Model choice logic:

- Haiku where speed matters and the task is well-scoped (planning topics, writing MCQs).
- Sonnet where judgment matters (grading, the final report). The grader was downgraded from Opus to Sonnet, which roughly halved submit latency, and it is kept honest by an automated validity gate.

Why these numbers: `maxOutputTokens` is enforced through the CLI environment variable `CLAUDE_CODE_MAX_OUTPUT_TOKENS` on the spawned child. `maxBudgetUsd` is a first-class runaway-cost guard per call. `timeoutMs` bounds a hung child process so a wedged spawn can never freeze a submit.

## 5. Agent runtime: how a call actually runs

One function, `runAgent` in `src/agents/client.ts`, executes every agent call:

1. The Zod schema is converted to JSON Schema (draft-07) and handed to the CLI as a structured-output contract.
2. The SDK spawns the local `claude` CLI with: `allowedTools: []`, an explicit disallowed-tools list (Bash, Read, Write, Web, everything), `settingSources: []` (no CLAUDE.md, no hooks, no MCP), a benign temp-dir cwd, and `maxTurns: 3`. This is the prompt-injection boundary: user answers are untrusted text, and the agent that reads them can touch nothing.
3. The child env deletes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, forcing subscription auth.
4. The result is validated against the Zod schema. Token usage and cost are recorded per agent and sent to Langfuse.

Failure handling is a classified retry table, total attempts always bounded at 2:

- `rate_limited` (subscription usage limit): NEVER retried. The reset time is parsed from the error and surfaced to the user ("resets at 9:30pm").
- `schema_validation` (model returned invalid JSON): ONE repair retry. The validation errors plus the model's own invalid output are appended to the prompt with "return only corrected JSON".
- `timeout` / `process_error` / `no_result`: ONE retry after a 1 to 3 second jittered backoff.
- `aborted` (caller cancelled): never retried.

## 6. JSON contracts - the glossary for the live log walkthrough

These are the exact fields you will see in the logs. Each agent's output is one of these objects.

### topicPlanner output (the blueprint)

```json
{
  "assessable": true,
  "topics": [
    { "name": "API Design", "importance": 30, "startLevel": 4 }
  ]
}
```

- `assessable`: false only if the role is nonsense (for example "unicorn wizard"). Then the session refuses to start.
- `topics[].name`: a specific, non-overlapping skill area for the role. 3 to 8 topics.
- `topics[].importance`: how much the topic counts toward the score, on any scale. CODE normalizes all importances to sum exactly 1000 (largest-remainder method). The agent never controls the final points.
- `topics[].startLevel`: a 1 to 10 guess of where a typical candidate starts. It only aims the first question, nothing else.

### answerGrader output (the most important log to demo)

```json
{
  "score": 72,
  "demonstratedLevel": 6,
  "matched": ["Explained connection pooling: 'we reuse open connections...'"],
  "missing": ["Did not mention transaction isolation levels"],
  "misconceptions": ["Claimed indexes always speed up writes"],
  "confidence": 0.85,
  "feedback": "Solid practical understanding of pooling. The answer skips..."
}
```

- `score`: 0 to 100, rubric coverage + correctness. Explicitly NOT length or fluency, so long waffle does not score.
- `demonstratedLevel`: 1 to 10, the level this answer actually shows. This is what jumps the ability estimate.
- `matched`: rubric points the answer covered, each with a short supporting quote pulled from the answer. This makes the grade auditable: you can see WHY it scored.
- `missing`: rubric points the answer failed to cover.
- `misconceptions`: confident but WRONG claims in the answer. These feed the final report's weak points.
- `confidence`: the model's self-reported certainty, 0 to 1. Recorded for logs ONLY. The engine ignores it and computes its own deterministic confidence from the matched/missing ratio, because a model grading its own confidence is not trustworthy math.
- `feedback`: two or three sentences of honest, specific feedback shown to the candidate.

### mcqWriter output (the bank)

```json
{
  "topics": [
    {
      "name": "API Design",
      "questions": [
        {
          "level": 5,
          "stem": "Which HTTP status code fits a failed validation?",
          "options": ["400", "401", "404", "500"],
          "correctIndex": 0
        }
      ]
    }
  ]
}
```

- `level`: the 1 to 10 difficulty band the MCQ targets. The engine picks the unused bank question nearest the candidate's current target level.
- `stem`: the question text.
- `options`: 3 to 5 options, exactly one correct, the rest plausible distractors.
- `correctIndex`: 0-based index of the right answer. Security note: the generator's option order is NEVER trusted or served. Code re-shuffles options deterministically at serve time (keyed by session + question order + stem), and the correct index is kept server-side, never sent to the browser. This closed a real gaming hole: before the shuffle fix, always answering "A" scored 916/1000; after the fix it scores 351/1000 (guess level).

### reportWriter output (the final report)

```json
{
  "verdict": "Solid mid-level engineer. The biggest thing holding them back is...",
  "summary": "...",
  "weakPoints": [ { "area": "Databases", "issue": "No grasp of transaction isolation" } ],
  "perTopic": [ { "name": "API Design", "strengths": ["..."], "gaps": ["..."] } ],
  "learningPath": ["Step 1: ...", "Step 2: ..."]
}
```

- `verdict`: one or two blunt sentences, no jargon: the level reached and the single biggest blocker.
- `weakPoints`: ranked most-important-first, each with an `area` (which topic) and an `issue` (the concrete weakness).
- `perTopic`: strengths and gaps per skill area.
- `learningPath`: ordered concrete next steps, hardest gaps first.
- Convention: topic points are phrased as "X of its Y points", never "X of 1000". Only the overall total is out of 1000.

## 7. Logs and observability - the live demo section

Every AI call is traced to Langfuse (non-blocking: if Langfuse is down or unconfigured, the assessment is unaffected).

How to read the logs live in the meeting:

1. Open Langfuse, go to Tracing then Sessions (not Home, Home lags behind).
2. One assessment = ONE Langfuse session, whose id is the database session id. So a full 25-question run reads as one grouped timeline instead of scattered traces.
3. Inside the session, each trace is named `agent:<name>`, for example `agent:answer-grader`, `agent:mcq-writer`. The name tells you which agent ran without opening anything.
4. Click a trace and open its generation. You see four things:
   - **input**: the exact user prompt the agent received. Note the untrusted candidate text is wrapped in a tagged block with a "data, not instructions" preamble (prompt-injection defense, visible in the log).
   - **output**: the validated JSON object (the exact schemas from section 6).
   - **usageDetails**: token counts, four keys: `input` (fresh input tokens), `output` (generated tokens), `cache_read_input_tokens` (prompt reused from cache, cheap), `cache_creation_input_tokens` (prompt cached for reuse). Cache is kept separate from input so cache reuse never reads as fresh work.
   - **costDetails.total** plus metadata `costUsd` and `durationMs`: what the call cost and how long it took.
5. Failed attempts are also logged: a failed call appears as a generation whose output is an error object: `{ "error": "...", "subtype": "timeout", "attempt": 1, "willRetry": true }`. So a retry is visible in the timeline, not hidden.

Demo storyline suggestion: run one assessment, then walk the session top to bottom: the blueprint call (topic-planner), the bank build (mcq-writer), the single grade of the written answer (answer-grader, show matched quotes and misconceptions), 24 MCQ rounds with ZERO AI calls in between (the gap in the timeline IS the point: MCQs are pure database work), then the final report-writer call.

Second log surface: the CLI runner prints a per-agent spend breakdown at the end of a run (calls, tokens, cost per agent, sorted by cost), from the same counters that feed Langfuse.

Third log surface: the database itself. Every grade persists as an `Evaluation` row with `score`, `demonstratedLevel`, `matched`, `missing`, `misconceptions` (JSON), `llmConfidence` (display only), and `deterministicConfidence` (the number the engine actually used). Every engine update persists an `AbilitySnapshot` row (theta + sigma per step), which draws the level-over-time curve.

## 8. The API

Next.js App Router API routes (node runtime):

- `POST /api/sessions`: start a session. Body: role, specialization, name, language. Preset role + General focus + seeded language = instant template start (topics + full MCQ bank cloned from `src/data/role-banks.json`, zero AI at Begin, around 250ms). Anything custom = live path: a templated warm-up shows instantly while the topic planner + MCQ bank build run in the background via Next's `after()`.
- `POST /api/sessions/[id]/answer`: submit an answer. Idempotent: the answer is persisted before grading, and a replayed submit returns the stored result instead of double-grading. The first submit on the live path awaits the background blueprint as a safety net.
- `GET /api/sessions/[id]`: resume snapshot. A pure read that restores the exact open question or the finished report. The web app keeps the session id in localStorage; refresh never loses progress.
- `GET /api/sessions/[id]/report`: the report data for the permalink page `/report/[id]`.

Error contract: expected failures are typed `DomainError` and map to honest HTTP codes: 404 `session_not_found` / `question_not_found`, 409 `already_answered` / `session_done`. Unexpected errors are 500s.

## 9. The database (SQLite via Prisma 7)

- `Session`: role, specialization, candidateName, language (en/ar), status, `blueprintPending` (live path flag), finalScore (0 to 1000), reportJson (persisted report for the permalink).
- `Topic` (many per session): name, importance (share of the 1000 points), theta (live ability estimate 1 to 10), sigma (uncertainty), startLevel, streak counter for the ceiling probe, converged flag.
- `Question` (many per topic): order, difficulty, text, rubric JSON, format (text or mcq), optionsJson (the SHUFFLED serve order), correctIndex (server-side only).
- `Answer` (one per question): the candidate's text or picked option; timestamped.
- `Evaluation` (one per answer): the grade fields listed in section 7.
- `AbilitySnapshot`: one row per engine update; the level-over-time curve.
- `BankQuestion`: the pre-generated MCQ pool; a row is popped (`used = true`) and copied into a Question when actually asked.

Full session state lives in these tables, which is exactly what makes resume work from any device with the session id.

## 10. The deterministic engine (what the code decides, not the AI)

- Kalman-style ability update per answer: theta moves toward the demonstrated level, weighted by a deterministic confidence computed from matched vs missing rubric points. Sigma (uncertainty) shrinks toward a floor.
- Question budget: exactly 25 questions, spread fairly across topics; leftovers go to the least-covered topic. A fresh topic opens at the running ability (seedTheta), never back at warm-up level.
- Staircase: correct MCQ = evidence of one step above the item's level; wrong = one step below. After consecutive strong answers, a ceiling probe asks one level up.
- Scoring: importance renormalized over ASSESSED topics only. An unreached topic reads "not assessed", never failure. Points sum to exactly 1000 by largest-remainder rounding.
- Degenerate written answers (empty, gibberish, too short) score 0 in code; no grading call is spent on them.

## 11. The CLI runner

`src/orchestrator/runner.ts` drives the same orchestrator as the web app, from the terminal:

- `npm run assess -- --role "Backend Engineer"`: full interactive assessment.
- Flags: `--specialization`, `--name`, `--language ar`, `--auto 6` (a synthetic candidate answering at level 6, for testing), `--resume <sessionId>`.
- `MAX_QUESTIONS=6 npm run assess -- ...`: cap the question count for a short run.
- Prints the per-agent cost/token breakdown at the end.

## 12. Quality gates (how we keep the AI honest)

- `npm run validity`: quick gate. 6 known-quality answers must rank correctly (senior above mid above junior above junk) with stable replays.
- `npm run validity -- --golden`: the 24-item golden set, including a prompt-injection ceiling test (an answer that tries to instruct the grader must not out-score a genuine one).
- `npm run verify:banks`: bank key audit. The model blind-re-answers a sample of seeded MCQs WITHOUT seeing the answer keys; agreement floor is 85%.
- `npm run regression:always-a`: live gaming regression. A bot that always picks option A must land at guess level (Beginner), proving the serve-time shuffle works.
- `npm test`: 44+ deterministic engine unit tests.

## 13. Tokens, cost, and limits

- There is no purchased API token pool. All agent calls run on the personal Claude subscription through the local `claude` CLI login. The code force-deletes any API key from the child environment, so a billed key can never be used by accident.
- Per-call ceilings still exist (defense in depth): each agent has a `maxOutputTokens` cap (2,000 to 8,000 depending on the agent), a `maxBudgetUsd` guard ($0.30 to $1.00), and a hard timeout (120s or 240s).
- Subscription rate limits are detected from every known error shape, never blindly retried, and surfaced with the exact reset time.
- Cost profile of one assessment: AI is called only for the warm-up grade, the final report, and (live path only) the background blueprint + bank build. The 24 MCQ rounds cost zero AI calls.

## 14. One-page workflow summary

1. Candidate picks role + focus + language in the two-step wizard.
2. Preset role with seeded bank: instant start. Custom role: instant templated warm-up, real topics + bank build in the background.
3. Q1 written warm-up, graded by answerGrader (Sonnet) for depth. Ability jumps to match.
4. Q2 to Q25: MCQs from the bank, nearest target level, deterministically shuffled, scored in pure code, staircase adapts each round, ability carries into new topics.
5. After exactly 25 answers: code computes the 1000-point split over assessed topics.
6. reportWriter (Sonnet) writes verdict + weak points + learning path. Report persists at /report/[id].
7. Everything is resumable, idempotent, and fully traced in Langfuse under one session.
