import {
  query,
  type Options,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import os from "node:os";
import { z } from "zod";
import { traceAgent } from "@/observability/langfuse";

// Tools are hard-disabled. User answers and the target role are UNTRUSTED free
// text that flows into these prompts, so an agent must never be able to touch
// the filesystem, run a shell, hit the web, or spawn a sub-task. allowedTools:[]
// plus this explicit belt, settingSources:[] (no CLAUDE.md / hooks / MCP), and a
// benign cwd make every assessment call text-in / JSON-out only. This is the
// prompt-injection boundary.
const DISALLOWED_TOOLS = [
  "Bash",
  "BashOutput",
  "KillShell",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Task",
  "TodoWrite",
];

// The SDK spawns this local CLI and reuses its subscription /login. Set it
// explicitly so the spawn cannot ENOENT from inside a bundled Next route.
const CLAUDE_CLI_PATH = process.env.CLAUDE_CLI_PATH || undefined;

// Token usage for one agent call, pulled straight from the SDK result. The CLI
// grader is billed on a subscription, but the raw token counts are what tell you
// where a session spends, so we surface them per agent instead of throwing them
// away with only the dollar figure.
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// Per-agent running totals for one session, so a CLI run can print a breakdown
// (which agent burned the most tokens) and Langfuse gets the same numbers.
export interface AgentSpend extends AgentUsage {
  agent: string;
  calls: number;
  costUsd: number;
}

// Process-wide spend accumulators. Let a CLI run or an API request report how
// much a session cost, and where, without threading cost through every return.
let _totalCostUsd = 0;
const _spendByAgent = new Map<string, AgentSpend>();

function recordSpend(agent: string, costUsd: number, usage: AgentUsage): void {
  _totalCostUsd += costUsd;
  const prev =
    _spendByAgent.get(agent) ??
    {
      agent,
      calls: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
  _spendByAgent.set(agent, {
    agent,
    calls: prev.calls + 1,
    costUsd: prev.costUsd + costUsd,
    inputTokens: prev.inputTokens + usage.inputTokens,
    outputTokens: prev.outputTokens + usage.outputTokens,
    cacheReadTokens: prev.cacheReadTokens + usage.cacheReadTokens,
    cacheCreationTokens: prev.cacheCreationTokens + usage.cacheCreationTokens,
  });
}

export function costSoFarUsd(): number {
  return _totalCostUsd;
}

// Per-agent breakdown of the current session's spend, ordered highest cost first.
export function costBreakdown(): AgentSpend[] {
  return [..._spendByAgent.values()].sort((a, b) => b.costUsd - a.costUsd);
}

export function resetCostUsd(): void {
  _totalCostUsd = 0;
  _spendByAgent.clear();
}

export class AgentError extends Error {
  constructor(
    message: string,
    readonly subtype: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export interface AgentRunInput<S extends z.ZodType> {
  agent: string;
  model: string;
  system: string;
  user: string;
  schema: S;
  maxOutputTokens?: number;
  maxBudgetUsd?: number;
  abort?: AbortController;
}

export interface AgentRunResult<T> {
  data: T;
  costUsd: number;
  usage: AgentUsage;
  sessionId: string;
  durationMs: number;
  raw: string;
}

// Last-resort repair when the model returns prose around the JSON instead of a
// clean structured_output object.
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in model output");
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function runOnce<S extends z.ZodType>(
  input: AgentRunInput<S>,
): Promise<AgentRunResult<z.infer<S>>> {
  const jsonSchema = z.toJSONSchema(input.schema) as Record<string, unknown>;
  // The CLI's --json-schema validator rejects the draft-2020-12 $schema meta-ref
  // that Zod emits at the top level. It is metadata, not part of the contract, so
  // drop it; the shape underneath is what constrains the output.
  delete jsonSchema.$schema;
  const started = Date.now();

  const options: Options = {
    model: input.model,
    systemPrompt: input.system,
    allowedTools: [],
    disallowedTools: DISALLOWED_TOOLS,
    settingSources: [],
    permissionMode: "dontAsk",
    // Headroom for the model to answer plus conform to the JSON schema on complex
    // inputs. Tools are disabled, so there is no agentic loop to run away here;
    // cost stays bounded by maxBudgetUsd and the output-token cap.
    maxTurns: 8,
    cwd: os.tmpdir(),
    outputFormat: { type: "json_schema", schema: jsonSchema },
    pathToClaudeCodeExecutable: CLAUDE_CLI_PATH,
    maxBudgetUsd: input.maxBudgetUsd,
    env: {
      ...process.env,
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(input.maxOutputTokens ?? 8000),
      // Force personal-subscription auth, never a billed API key.
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
    },
    ...(input.abort ? { abortController: input.abort } : {}),
  };

  let resultMsg: SDKResultMessage | null = null;
  let sessionId = "";
  for await (const message of query({ prompt: input.user, options })) {
    if ("session_id" in message && typeof message.session_id === "string") {
      sessionId = message.session_id;
    }
    if (message.type === "result") resultMsg = message;
  }

  if (!resultMsg) {
    throw new AgentError(`${input.agent}: no result message`, "no_result");
  }
  if (resultMsg.subtype !== "success") {
    throw new AgentError(
      `${input.agent} failed: ${resultMsg.subtype}`,
      resultMsg.subtype,
    );
  }

  const durationMs = Date.now() - started;
  const raw = typeof resultMsg.result === "string" ? resultMsg.result : "";
  const candidate = resultMsg.structured_output ?? extractJson(raw);
  const data = input.schema.parse(candidate) as z.infer<S>;
  const costUsd = resultMsg.total_cost_usd ?? 0;

  // Token counts come straight off the SDK result (usage is snake_case BetaUsage).
  const u = resultMsg.usage;
  const usage: AgentUsage = {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u?.cache_creation_input_tokens ?? 0,
  };
  recordSpend(input.agent, costUsd, usage);

  traceAgent({
    agent: input.agent,
    model: input.model,
    costUsd,
    usage,
    durationMs,
    sessionId,
    input: input.user,
    output: data,
  });

  return { data, costUsd, usage, sessionId, durationMs, raw };
}

// One retry: a fresh query re-rolls the model, which clears most transient
// failures (a bad grade, malformed JSON, an overload). A full 15-30 call
// session must not abort on a single hiccup.
export async function runAgent<S extends z.ZodType>(
  input: AgentRunInput<S>,
): Promise<AgentRunResult<z.infer<S>>> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await runOnce(input);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
