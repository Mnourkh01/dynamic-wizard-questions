@AGENTS.md

# Dynamic Wizard Questions - project guide

Adaptive AI skill assessment. Asks free-text questions for a role, grades each answer with AI, adapts the next question to the demonstrated level, ends with a score out of 1000 split across dynamic topics.

## The one principle that keeps this clean

**AI agents do only the fuzzy language work. Deterministic code owns every number.**
The four agents (blueprint, question, grader, reporter) take text in and return validated JSON. The per-topic ability estimate, next-question choice, stop condition, and the 1000-point score all live in pure `core/` code. LLMs never carry numeric state across turns.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript (strict). Arm B.
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) spawning the local `claude` CLI on the personal subscription. **No `ANTHROPIC_API_KEY`** - agents force it unset so they always run on subscription auth, never a billed key.
- Prisma 7 + SQLite via the `@prisma/adapter-better-sqlite3` driver adapter (v1 is single-user local).
- Zod 4 for every agent output contract.
- Langfuse (optional, non-blocking) for tracing.
- Vitest for the deterministic engine tests.

## Architecture (dependencies point inward; `core/` imports nothing else)

- `src/core/` - pure domain: constants, types, ladder, answer classifier, adaptive policy, scoring. Fully unit tested, no I/O.
- `src/agents/` - the four agents + the SDK wrapper (`client.ts`) + config + Zod schemas. Tools hard-disabled.
- `src/orchestrator/` - `session.ts` (I/O shell: start + submit, persisted, resumable) and `runner.ts` (CLI harness).
- `src/db/` - Prisma singleton.
- `src/observability/` - non-blocking Langfuse wrapper.
- `src/validity/` - the validity gate (proves the score measures skill).
- `src/app/` - Next routes + UI (Phase 2).
- `src/generated/prisma/` - generated Prisma client (do not edit).

## Commands

- `npm run dev` - dev server (use port 3001; 3000 is reserved for Langfuse).
- `npm run assess -- --role "Senior Backend Engineer"` - full CLI assessment (interactive).
- `npm run assess -- --role "..." --auto 6` - synthetic candidate at level 6 (unattended).
- `MAX_QUESTIONS=6 npm run assess -- ...` - cap questions for a short/cheap run.
- `npm run validity` - the validity gate (grades known-quality answers, checks ranking + variance).
- `npm test` - deterministic engine tests.
- `npm run typecheck` - `tsc --noEmit`.
- `npm run db:migrate` / `npm run db:generate` - Prisma.

## Conventions

- Import alias `@/*` -> `src/*` (Next, tsx, and vitest all resolve it; vitest via `vitest.config.ts`).
- No em-dash or en-dash in any user-visible copy (including model output; agents are instructed against it).
- Every number is decided in `core/`, never by an agent. Weights are normalized to exactly 1000 in code (largest-remainder).
- Agent calls: `allowedTools: []`, explicit `disallowedTools`, `settingSources: []`, benign cwd. Untrusted user text is wrapped in `tag()` with a "data not instructions" preamble.
- Prisma 7 client needs a driver adapter; the SDK, prisma client, adapter, and `better-sqlite3` are in `serverExternalPackages` so Next does not bundle them.

## Known constraints

- Latency: a `claude` spawn per agent step, on a personal subscription, is slow and can be rate-limited. A full session is 15-25 sequential calls. v1 accepts this (single-user local). Multi-user + real API key = v2.
- v1 scope: single-user local self-assessment. The report is labeled a self-assessment.

See `PLAN.md` for the full plan and `docs/system.md` for the system graph.
