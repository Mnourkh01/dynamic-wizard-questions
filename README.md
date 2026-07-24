# Dynamic Wizard Questions

Adaptive AI skill assessment for technical roles. A candidate picks a role, answers exactly 25 questions (1 written, 24 multiple choice), and gets an honest report with a score out of 1000 split across the skill topics that matter for that role. The exam adapts in real time: the difficulty follows the level the candidate actually demonstrates, question by question.

Built with Next.js 16, React 19, TypeScript (strict), Prisma 7 + SQLite, Zod 4, and the Claude Agent SDK. English and Arabic end to end, including fully pre-seeded Arabic question banks.

## The core design principle

**AI agents do only the fuzzy language work. Deterministic code owns every number.**

Five single-purpose agents (topic planning, question writing, MCQ bank generation, answer grading, report writing) take text in and return schema-validated JSON out. Everything numeric lives in pure, unit-tested TypeScript under `src/core/`: the ability estimate, the next-question choice, the difficulty staircase, MCQ scoring, the option shuffle, and the 1000-point score. An LLM never carries numeric state across turns. That is what makes the score reproducible and trustworthy.

## How an assessment runs

1. **Setup wizard**: role chips, then focus/stack and an optional name. A preset role with a pre-seeded bank starts instantly (topics + full MCQ bank cloned from `src/data/role-banks.json`, zero AI calls at Begin, around 250ms). A custom role or specialization takes the live path: a templated warm-up shows immediately while the real topic blueprint and MCQ bank build in the background.
2. **Question 1, the only written question**: a templated opener. The answer is AI-graded for depth against a rubric; a deep answer jumps the starting ability estimate several levels at once, a shallow one barely moves it. Degenerate answers (empty, gibberish) score 0 in code without spending a grading call.
3. **Questions 2 to 25, all MCQ**: served instantly from the pre-generated bank, nearest to the current target level. Options are re-shuffled deterministically at serve time (keyed by session + order + stem) and the correct index never leaves the server, so the exam cannot be gamed by position. Scoring is pure code: correct = evidence one step above the item's level, wrong = one step below, forming an adaptive staircase with ceiling probes after consecutive strong answers. Ability carries into fresh topics, so a strong candidate is never reset to beginner questions.
4. **Scoring and report**: after exactly 25 answers, code renormalizes topic importance over assessed topics only (an unreached topic reads "not assessed", never failure) and computes the 1000-point split by largest-remainder rounding. The report agent then writes the verdict, ranked weak points, per-topic strengths and gaps, and a learning path. The report persists at a permalink, `/report/<sessionId>`.
5. **Resume anywhere**: full state lives in SQLite. A page refresh (web, via localStorage) or `--resume <sessionId>` (CLI) restores the exact open question or the finished report. Answer submission is idempotent; a replayed submit returns the stored result.

## The five agents

| Agent | Model | Responsibility | Runs |
|---|---|---|---|
| topicPlanner | Haiku | Structures a role + specialization into 3 to 8 weighted skill topics | Once at start (live path) |
| mcqWriter | Haiku | Batch-generates the whole MCQ bank for a session | Background at start |
| questionWriter | Haiku | Single-question fallback when the bank runs dry | Rare |
| answerGrader | Sonnet | Grades the written warm-up against the rubric; returns matched/missing points with quotes, misconceptions, demonstrated level | Once per session |
| reportWriter | Sonnet | Turns the transcript + computed scores into the final report | Once at end |

Every agent call is hardened: all tools disabled (`allowedTools: []` plus an explicit disallow list), no settings sources, a benign temp cwd, and untrusted candidate text wrapped in a tagged "data, not instructions" block. Failures are classified and retried at most once: schema failures get one repair pass with the validation errors shown back, transient process failures get one jittered retry, and subscription rate limits are never retried, they surface with the exact reset time. Per-agent output-token caps, dollar budget guards, and hard timeouts bound every call.

The agents run on a personal Claude subscription through the local `claude` CLI. The child environment force-deletes `ANTHROPIC_API_KEY`, so a billed key can never be used by accident.

## Observability

Optional, non-blocking Langfuse tracing: one assessment groups as one Langfuse session (the DB session id). Each call is a trace named `agent:<name>` carrying the exact input prompt, the validated JSON output, token usage split by fresh input / output / cache read / cache creation, cost, and duration. Failed attempts are logged with their failure class and whether a retry followed. The CLI prints the same per-agent spend breakdown at the end of a run.

## Architecture

Dependencies point inward; `src/core/` imports nothing else.

```
src/core/          Pure domain: constants, types, ladder, adaptive policy,
                   MCQ grading + deterministic shuffle, scoring. No I/O, fully tested.
src/agents/        The five agents + the SDK wrapper (timeouts, classified retries,
                   rate-limit detection) + Zod output schemas. Tools hard-disabled.
src/orchestrator/  session.ts (start/submit/resume, persisted, idempotent) and
                   runner.ts (interactive CLI harness).
src/data/          Pre-seeded role banks (10 preset roles x 2 languages, 710 MCQs).
src/db/            Prisma singleton (SQLite via better-sqlite3 driver adapter).
src/observability/ Non-blocking Langfuse wrapper.
src/validity/      Validity gate (quick mode + 24-item golden set).
src/app/           Next.js App Router routes + wizard UI (EN/AR, RTL-aware).
scripts/           Bank seeder, bank key verifier, live gaming regression.
```

API surface: `POST /api/sessions` (start), `POST /api/sessions/[id]/answer` (idempotent submit), `GET /api/sessions/[id]` (resume snapshot), `GET /api/sessions/[id]/report` (permalink data). Expected failures are typed and map to honest HTTP codes: 404 `session_not_found` / `question_not_found`, 409 `already_answered` / `session_done`.

Data model: `Session -> Topic -> Question -> Answer -> Evaluation`, plus `AbilitySnapshot` (one row per engine update, drives the level-over-time curve) and `BankQuestion` (the pre-generated MCQ pool). See `docs/system.md` for the full system graph and `docs/team-briefing.md` for a complete walkthrough including the JSON field glossary.

## Setup

```bash
npm install
cp .env.example .env      # set CLAUDE_CLI_PATH to your `claude` binary
npm run db:migrate        # creates dev.db (SQLite)
```

You must be signed into the `claude` CLI (the agents reuse your subscription login). No `ANTHROPIC_API_KEY` is needed or used.

## Run

```bash
# Web wizard (port 3001; 3000 is reserved for Langfuse)
npm run dev

# Interactive CLI assessment
npm run assess -- --role "Backend Engineer"

# Scoped to a stack, with a name on the report, or in Arabic
npm run assess -- --role "Backend Engineer" --specialization "Python (Django/FastAPI)" --name "Sam" --language ar

# Unattended run with a synthetic candidate at a target level
npm run assess -- --role "Backend Engineer" --auto 6

# Continue a saved session
npm run assess -- --resume <sessionId>

# Short/cheap run (cap the number of questions)
MAX_QUESTIONS=6 npm run assess -- --role "Backend Engineer" --auto 6
```

## Quality gates

The AI is kept honest by automated gates, not by trust:

```bash
# Prove the score measures skill (6 known-quality answers: ranking + variance)
npm run validity

# Golden-set gate: 24 hand-written items, band ordering senior > mid > junior > junk,
# plus a prompt-injection ceiling (an answer that instructs the grader must not win)
npm run validity -- --golden

# Audit the pre-seeded MCQ answer keys: blind re-answer without the keys, 85% floor
npm run verify:banks

# Always-A gaming regression against a running dev server: always picking the first
# option must land at guess level, proving the serve-time shuffle works
npm run regression:always-a

# Deterministic engine tests (includes the always-A unit regression)
npm test

# Fill the pre-seeded role banks (incremental; English by default)
npm run seed:roles
npm run seed:roles -- --language ar
```

## Scope

v1 is a single-user, local, unproctored self-assessment (the report says so). It runs on a long-lived local host, not serverless, because the Agent SDK spawns the local `claude` CLI. Multi-user, real API-key billing, and proctoring are v2 concerns.

See `PLAN.md` for the full plan and status, `docs/system.md` for the system graph, and `CLAUDE.md` for the contributor guide.
