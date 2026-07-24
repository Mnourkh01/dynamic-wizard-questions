# Dynamic Wizard Questions

Adaptive AI skill assessment. It opens with one written warm-up question that AI grades for depth, then runs a continuous exam of multiple-choice questions served instantly from a pre-generated bank, adapting the difficulty to the level you actually demonstrate and carrying your ability across topics. Exactly 25 questions, then a report with a score out of 1000 split across topics derived from the role.

It borrows the Computerized Adaptive Testing loop (estimate ability, ask at that ability, refine) but reads the starting depth from one open answer graded by an LLM, then confirms and brackets the level with a deterministic MCQ staircase. The design rule: **AI does the language work, deterministic code owns every number** (including the serve-time MCQ option shuffle that keeps the exam ungameable).

## v1 scope

Single-user, local, unproctored self-assessment. The engine drives one personal Claude subscription through the local `claude` CLI, so it runs on a long-running local host, not serverless, and the report is labeled a self-assessment. Multi-user + a real API key + billing is v2.

## Setup

```bash
npm install
cp .env.example .env      # set CLAUDE_CLI_PATH to your `claude` binary
npm run db:migrate        # creates dev.db (SQLite)
```

You must be signed into the `claude` CLI (it uses your subscription login). No `ANTHROPIC_API_KEY` is needed or used.

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

In the web app, preset roles (with the General focus) start instantly when a pre-seeded question bank exists for the chosen language. A custom role, a specialization, or an unseeded role/language pair builds its plan live in the background while you answer the warm-up. A refresh mid-run resumes where you left off, and every finished report has a permalink at `/report/<sessionId>`.

## Quality gates

```bash
# Prove the score measures skill (6 known-quality answers: ranking + variance)
npm run validity

# Golden-set gate: 24 hand-written items, band ordering + prompt-injection ceiling
npm run validity -- --golden

# Audit the pre-seeded MCQ answer keys (blind re-answer, 85% agreement floor)
npm run verify:banks

# Always-A gaming regression against a running dev server
npm run regression:always-a

# Deterministic engine tests (includes the always-A unit regression)
npm test

# Fill the pre-seeded role banks (incremental; English by default)
npm run seed:roles
npm run seed:roles -- --language ar
```

See `PLAN.md` for the full plan and status, `docs/system.md` for the system graph, and `CLAUDE.md` for the project guide.
