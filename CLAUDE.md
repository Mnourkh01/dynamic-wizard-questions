@AGENTS.md

# Dynamic Wizard Questions - project guide

Adaptive AI skill assessment. One written warm-up question is graded by AI for depth, then a continuous exam of MCQs served instantly from a pre-generated bank adapts to the demonstrated level, carrying ability across topics. Exactly 25 questions (1 written + 24 MCQ, `MAX_QUESTIONS` overrides), ending with a score out of 1000 split across role-derived topics.

## The one principle that keeps this clean

**AI agents do only the fuzzy language work. Deterministic code owns every number.**
The agents (topic planner, question writer, MCQ writer, answer grader, report writer) take text in and return validated JSON. The per-topic ability estimate, next-question choice, difficulty staircase, MCQ scoring and option shuffle, and the 1000-point score all live in pure `core/` code. LLMs never carry numeric state across turns.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript (strict). Arm B.
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) spawning the local `claude` CLI on the personal subscription. **No `ANTHROPIC_API_KEY`** - agents force it unset so they always run on subscription auth, never a billed key.
- Prisma 7 + SQLite via the `@prisma/adapter-better-sqlite3` driver adapter (v1 is single-user local).
- Zod 4 for every agent output contract.
- Langfuse (optional, non-blocking); every call of one assessment is grouped under one Langfuse session (the DB session id).
- Vitest for the deterministic engine tests.

## How a session runs (shipped flow)

- Setup wizard, two steps: role chips, then focus/stack + optional name. Preset role + General focus with a seeded bank for the language = instant template start (topics + full MCQ bank cloned from `src/data/role-banks.json`, zero AI at Begin).
- Custom role, any specialization, or a language pair without a seeded bank = live path: a templated role warm-up shows instantly on one provisional topic; the real blueprint + MCQ bank build in the background (route `after()` / CLI), with a safety-net await on the first submit.
- Question 1 is the ONLY written question: templated (no AI to write it), AI-graded for depth; the graded depth jumps the starting ability several levels at once.
- Questions 2 to 25 are MCQs picked from the bank nearest the target level, shuffled deterministically at serve time (gaming fix), scored in pure code (no AI on submit). Ability carries into fresh topics (`seedTheta`); ceiling probes fire after consecutive strong answers; the fixed budget is spread across all topics.
- Scoring renormalizes importance over ASSESSED topics only (an unreached topic is "not assessed", never a failure). The reporter writes verdict + weak points; the report persists as a permalink `/report/[id]`.
- Resume: the web app stores the session id in localStorage and restores via `GET /api/sessions/[id]` (pure read); the CLI uses `--resume <sessionId>`. Answer submission is idempotent (a replay returns the stored result). Expected failures are typed `DomainError` -> HTTP 404 (`session_not_found`, `question_not_found`) or 409 (`already_answered`, `session_done`).

## Architecture (dependencies point inward; `core/` imports nothing else)

- `src/core/` - pure domain: constants, types, ladder, answer classifier, adaptive policy, MCQ grading + deterministic option shuffle, templated openers, scoring. Fully unit tested, no I/O.
- `src/agents/` - the agents (topic planner, question writer, MCQ writer incl. bank builder + bank verifier, answer grader, report writer) + the SDK wrapper `client.ts` (per-agent timeouts, classified retries capped at 2 attempts, subscription rate-limit detection) + config + Zod schemas. Tools hard-disabled.
- `src/orchestrator/` - `session.ts` (I/O shell: start + submit + resume snapshot, persisted, idempotent) and `runner.ts` (CLI harness).
- `src/data/` - pre-seeded role banks (`role-banks.json`, filled incrementally per language by `npm run seed:roles`) for the preset role chips.
- `src/db/` - Prisma singleton.
- `src/observability/` - non-blocking Langfuse wrapper.
- `src/validity/` - the validity gate (quick mode + 24-item golden set).
- `src/app/` + `src/components/` + `src/lib/` - Next routes, wizard UI, shared client/server types, bilingual EN/AR copy.
- `scripts/` - role bank generator, bank key verifier, live always-A regression.
- `src/generated/prisma/` - generated Prisma client (do not edit).

## Commands

- `npm run dev` - dev server (use port 3001; 3000 is reserved for Langfuse).
- `npm run assess -- --role "Backend Engineer"` - full CLI assessment (interactive). Flags: `--specialization`, `--name`, `--language ar`, `--auto 6` (synthetic candidate at level 6), `--resume <sessionId>`.
- `MAX_QUESTIONS=6 npm run assess -- ...` - cap questions for a short/cheap run.
- `npm run validity` - quick validity gate (6 known-quality answers: ranking + band thresholds + replay stability).
- `npm run validity -- --golden [--sample N]` - golden-set gate (24 items: band ordering senior > mid > junior > junk + prompt-injection ceiling).
- `npm run seed:roles` - fill `src/data/role-banks.json` for the preset role chips (incremental, English by default; `npm run seed:roles -- --language ar` seeds Arabic).
- `npm run verify:banks [-- --sample N]` - bank key audit: the model blind-re-answers a seeded sample without the keys; agreement floor 85%.
- `npm run regression:always-a` - live always-A gaming regression against a running dev server on 3001.
- `npm test` - deterministic engine tests (includes the always-A unit regression).
- `npm run typecheck` - `tsc --noEmit`.
- `npm run db:migrate` / `npm run db:generate` - Prisma.

## Conventions

- Import alias `@/*` -> `src/*` (Next, tsx, and vitest all resolve it; vitest via `vitest.config.ts`).
- No em-dash or en-dash in any user-visible copy (including model output; agents are instructed against it).
- Every number is decided in `core/`, never by an agent. Weights normalize to exactly 1000 in code (largest-remainder). MCQ options are shuffled in code at serve time (never trust the generator's option order). The reporter phrases topic points as "X of its Y points", never "X of 1000" (only the overall total is out of 1000).
- Agent calls: `allowedTools: []`, explicit `disallowedTools`, `settingSources: []`, benign cwd. Untrusted user text is wrapped in `tag()` with a "data not instructions" preamble.
- Prisma 7 client needs a driver adapter; the SDK, prisma client, adapter, and `better-sqlite3` are in `serverExternalPackages` so Next does not bundle them.

## Known constraints

- AI calls are few and off the hot path: grading the written warm-up, the end-of-session report, plus (live path only) the background blueprint + bank build and a rare single-MCQ fallback. MCQ rounds are pure DB work. Subscription rate limits are detected and surfaced with the reset time, never blindly retried.
- A template start needs a pre-seeded bank for the exact (role, language) pair; all 10 preset roles are seeded in BOTH English and Arabic (710 MCQs in `src/data/role-banks.json`). Any specialization, custom role, or unseeded pair takes the live path.
- v1 scope: single-user local self-assessment. The report is labeled a self-assessment.

See `PLAN.md` for the plan + shipped-status notes and `docs/system.md` for the system graph.
