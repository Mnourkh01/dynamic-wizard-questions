# Dynamic Wizard Questions

Adaptive AI skill assessment. It asks free-text questions for a target role, grades each answer with AI, adapts the next question to the level you actually demonstrate, and ends with a score out of 1000 split across topics it derives from the role.

It borrows the Computerized Adaptive Testing loop (estimate ability, ask for maximum information, stop when confident) but grades open answers with an LLM instead of using a fixed multiple-choice bank. The design rule: **AI does the language work, deterministic code owns every number.**

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
# Interactive assessment
npm run assess -- --role "Senior Backend Engineer"

# Unattended run with a synthetic candidate at a target level
npm run assess -- --role "Backend Engineer" --auto 6

# Short/cheap run (cap the number of questions)
MAX_QUESTIONS=6 npm run assess -- --role "Backend Engineer" --auto 6

# Prove the score measures skill (grades known-quality answers, checks ranking + variance)
npm run validity

# Deterministic engine tests
npm test
```

The web wizard (single-page "Liquid depth gauge") is Phase 2.

See `PLAN.md` for the full plan, `docs/system.md` for the system graph, and `CLAUDE.md` for the project guide.
