import {
  query,
  type Options,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import os from "node:os";
import { z } from "zod";
import { traceAgent } from "@/observability/langfuse";
import { timeoutMsForAgentLabel } from "./config";

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

// A failed agent call, classified. subtype drives the retry decision in
// runAgent. raw carries the model's invalid output when the failure was a
// schema/JSON one (so the repair retry can show it back); resetsAtMs carries
// the subscription-limit reset time when one was parseable.
export class AgentError extends Error {
  readonly subtype: string;
  readonly raw?: string;
  readonly resetsAtMs?: number;

  constructor(
    message: string,
    subtype: string,
    extra?: { raw?: string; resetsAtMs?: number },
  ) {
    super(message);
    this.name = "AgentError";
    this.subtype = subtype;
    this.raw = extra?.raw;
    this.resetsAtMs = extra?.resetsAtMs;
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
  // Hard per-call deadline override; when absent the per-agent config value
  // (timeoutMsForAgentLabel) applies.
  timeoutMs?: number;
  abort?: AbortController;
  // The assessment's DB session id. Groups every call of one assessment into
  // ONE Langfuse session; without it each call lands under its own throwaway
  // CLI session id and a 25-step run scatters into 25 unrelated traces.
  groupId?: string;
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

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reset epochs arrive in seconds ("...|1750320000") or milliseconds depending
// on the source; normalize to milliseconds.
function normalizeEpochMs(value: number | undefined): number | undefined {
  if (!value || !Number.isFinite(value) || value <= 0) return undefined;
  return value < 1e12 ? value * 1000 : value;
}

// The subscription usage limit does NOT surface as a typed error. Known shapes,
// all observed in the wild: a result with subtype "success" but is_error true
// whose text is "Claude AI usage limit reached|<epoch>", prose like "You've hit
// your session limit, resets 9:30pm", "API Error: Rate limit reached", or a
// {"error_type":"grace_daily_limit_reached"} blob (seen exactly in this setup:
// Windows, API key unset to force subscription auth). Matched BEFORE any JSON
// parsing so a closed limit window is never misread as malformed output.
const USAGE_LIMIT_EPOCH = /usage limit reached\s*\|\s*(\d{9,13})/i;
const RATE_LIMIT_PATTERNS: RegExp[] = [
  USAGE_LIMIT_EPOCH,
  /grace_daily_limit_reached/i,
  /\b(?:usage|rate|session|weekly|daily|5-hour)[ _-]?limit\b[^.]{0,40}\b(?:reached|hit|exceeded)\b/i,
  /\b(?:hit|reached|exceeded)\b[^.]{0,40}\b(?:usage|rate|session|weekly|daily|plan)[ _-]?limit\b/i,
  /\blimit reached\b[^.]{0,60}\bresets?\b/i,
];

function detectRateLimit(text: string): { matched: boolean; resetsAtMs?: number } {
  if (!text) return { matched: false };
  const epoch = USAGE_LIMIT_EPOCH.exec(text);
  if (epoch) return { matched: true, resetsAtMs: normalizeEpochMs(Number(epoch[1])) };
  return { matched: RATE_LIMIT_PATTERNS.some((p) => p.test(text)) };
}

async function runOnce<S extends z.ZodType>(
  input: AgentRunInput<S>,
  // Appended to the user prompt on a schema-repair retry only; never set on a
  // first attempt. This is the one sanctioned way a retry may alter the prompt.
  repairSuffix?: string,
): Promise<AgentRunResult<z.infer<S>>> {
  // The CLI's structured-output validator speaks JSON Schema draft-07 and
  // rejects newer dialects; Zod emits draft-2020-12 by default, so target
  // draft-7 explicitly (Zod normalizes the name to draft-07 internally).
  const jsonSchema = z.toJSONSchema(input.schema, {
    target: "draft-7",
  }) as Record<string, unknown>;
  // The $schema meta-ref is metadata, not part of the contract; drop it so the
  // CLI validates the shape underneath without dialect hair-splitting.
  delete jsonSchema.$schema;
  const started = Date.now();

  // Every call gets a hard deadline: a hung `claude` child (network stall,
  // wedged spawn, silent backoff) must fail the attempt, not the session.
  const timeoutMs = input.timeoutMs ?? timeoutMsForAgentLabel(input.agent);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // Windows caveat: aborting the query ends the async iterator, but the SDK
    // may leak the spawned `claude` child process tree, and this SDK version
    // (0.3.x) exposes no child pid to taskkill. Accepted for v1 (single user,
    // local): a leaked child idles out on its own; revisit if the SDK ever
    // surfaces the pid.
    controller.abort();
  }, timeoutMs);
  // Bridge an external abort (route cancellation) into the same controller.
  const onCallerAbort = () => controller.abort();
  input.abort?.signal.addEventListener("abort", onCallerAbort, { once: true });

  // The limit notice can also arrive on stderr only, so keep a bounded tap.
  let stderrTail = "";
  const stderrTap = (data: string): void => {
    if (stderrTail.length < 4000) stderrTail += data;
  };

  // Child env: inherit, cap output tokens, skip the SDK's advisory `claude -v`
  // version-check subprocess (0.3-0.8s saved per call, safe with a current CLI).
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(input.maxOutputTokens ?? 8000),
    CLAUDE_AGENT_SDK_SKIP_VERSION_CHECK: "1",
  };
  // Force personal-subscription auth, never a billed API key. Deleted outright
  // (not set to undefined) so the guarantee does not depend on how the spawn
  // layer treats undefined env values.
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.ANTHROPIC_AUTH_TOKEN;

  const options: Options = {
    model: input.model,
    systemPrompt: input.system,
    allowedTools: [],
    disallowedTools: DISALLOWED_TOOLS,
    settingSources: [],
    permissionMode: "dontAsk",
    // Tools are disabled, so a correct call is ONE assistant turn; the only
    // legitimate extra turns are the CLI's internal structured-output repair
    // loop. 3 bounds a flailing repair loop at subscription latency.
    maxTurns: 3,
    cwd: os.tmpdir(),
    outputFormat: { type: "json_schema", schema: jsonSchema },
    pathToClaudeCodeExecutable: CLAUDE_CLI_PATH,
    maxBudgetUsd: input.maxBudgetUsd,
    // Nothing here is ever resumed; skip writing a session JSONL to
    // ~/.claude/projects for every one-shot call.
    persistSession: false,
    stderr: stderrTap,
    env: childEnv,
    abortController: controller,
  };

  const prompt = repairSuffix ? `${input.user}\n\n${repairSuffix}` : input.user;

  let resultMsg: SDKResultMessage | null = null;
  let sessionId = "";
  // The SDK also emits a structured rate_limit_event for subscription users;
  // capture a rejection so detection does not rely on prose alone.
  let rateLimitRejected = false;
  let rateLimitResetMs: number | undefined;
  try {
    for await (const message of query({ prompt, options })) {
      if ("session_id" in message && typeof message.session_id === "string") {
        sessionId = message.session_id;
      }
      if (
        message.type === "rate_limit_event" &&
        message.rate_limit_info.status === "rejected"
      ) {
        rateLimitRejected = true;
        rateLimitResetMs =
          normalizeEpochMs(message.rate_limit_info.resetsAt) ?? rateLimitResetMs;
      }
      if (message.type === "result") resultMsg = message;
    }
  } catch (err) {
    if (err instanceof AgentError) throw err;
    if (timedOut) {
      throw new AgentError(
        `${input.agent}: call timed out after ${timeoutMs}ms`,
        "timeout",
      );
    }
    if (input.abort?.signal.aborted) {
      throw new AgentError(`${input.agent}: aborted by caller`, "aborted");
    }
    // Spawn or stream failure before a usable result: transient class.
    const detail = err instanceof Error ? err.message : String(err);
    throw new AgentError(
      `${input.agent}: process error: ${clip(detail, 400)}${
        stderrTail ? ` | stderr: ${clip(stderrTail, 400)}` : ""
      }`,
      "process_error",
    );
  } finally {
    clearTimeout(timer);
    input.abort?.signal.removeEventListener("abort", onCallerAbort);
  }

  if (!resultMsg) {
    if (timedOut) {
      throw new AgentError(
        `${input.agent}: call timed out after ${timeoutMs}ms`,
        "timeout",
      );
    }
    throw new AgentError(`${input.agent}: no result message`, "no_result");
  }

  const raw =
    resultMsg.subtype === "success" && typeof resultMsg.result === "string"
      ? resultMsg.result
      : "";
  const structured =
    resultMsg.subtype === "success" ? resultMsg.structured_output : undefined;
  const cliErrors = resultMsg.subtype !== "success" ? resultMsg.errors.join("\n") : "";

  // Rate-limit detection runs BEFORE any JSON handling, but only when the call
  // already looks unhealthy (rejected event, is_error, error subtype, or no
  // structured output). A healthy structured answer is never scanned, so a
  // grader answer ABOUT rate limits cannot false-positive here.
  if (
    rateLimitRejected ||
    resultMsg.is_error ||
    resultMsg.subtype !== "success" ||
    structured === undefined
  ) {
    const hit = detectRateLimit([raw, cliErrors, stderrTail].join("\n"));
    if (rateLimitRejected || hit.matched) {
      const resetsAtMs = hit.resetsAtMs ?? rateLimitResetMs;
      const when = resetsAtMs ? new Date(resetsAtMs).toLocaleString() : "unknown";
      throw new AgentError(
        `${input.agent}: Claude subscription usage limit reached; resets at ${when}. Not retried; try again after the reset.`,
        "rate_limited",
        { resetsAtMs },
      );
    }
  }

  if (resultMsg.subtype !== "success") {
    throw new AgentError(
      `${input.agent} failed: ${resultMsg.subtype}${
        cliErrors ? ` | ${clip(cliErrors, 300)}` : ""
      }`,
      resultMsg.subtype,
    );
  }
  // Headless trap: subtype "success" with is_error true and the real story only
  // in the result prose. Not a parseable output; surface it as its own class.
  if (resultMsg.is_error) {
    throw new AgentError(
      `${input.agent}: result flagged is_error: ${clip(raw, 300)}`,
      "result_error",
    );
  }

  const durationMs = Date.now() - started;
  let candidate: unknown;
  if (structured !== undefined) {
    candidate = structured;
  } else {
    try {
      candidate = extractJson(raw);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new AgentError(
        `${input.agent}: output is not valid JSON: ${clip(detail, 300)}`,
        "schema_validation",
        { raw },
      );
    }
  }
  const parsed = input.schema.safeParse(candidate);
  if (!parsed.success) {
    throw new AgentError(
      `${input.agent}: output failed schema validation: ${clip(parsed.error.message, 600)}`,
      "schema_validation",
      { raw: raw || JSON.stringify(candidate) },
    );
  }
  const data = parsed.data as z.infer<S>;
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
    sessionId: input.groupId ?? sessionId,
    input: input.user,
    output: data,
  });

  return { data, costUsd, usage, sessionId, durationMs, raw };
}

// How one failure class is retried (or not). Exactly one retry maximum, so a
// call is always bounded at 2 attempts.
interface RetryPlan {
  subtype: string;
  retry: boolean;
  backoffMs: number;
  repair: boolean;
}

function planRetry(err: unknown): RetryPlan {
  if (err instanceof AgentError) {
    // The limit window is closed; a retry just burns it. The caller gets the
    // reset time in the message. An external abort is deliberate, never re-run.
    if (err.subtype === "rate_limited" || err.subtype === "aborted") {
      return { subtype: err.subtype, retry: false, backoffMs: 0, repair: false };
    }
    // Schema/JSON failure: one targeted repair pass. The model nearly made it;
    // show it the validation errors and its own output, ask for corrected JSON.
    if (err.subtype === "schema_validation") {
      return { subtype: err.subtype, retry: true, backoffMs: 0, repair: true };
    }
    // Transient spawn/process failures: short jittered backoff (1-3s) so the
    // retry does not land on the exact condition that killed attempt one.
    if (
      err.subtype === "timeout" ||
      err.subtype === "no_result" ||
      err.subtype === "process_error"
    ) {
      return {
        subtype: err.subtype,
        retry: true,
        backoffMs: 1000 + Math.floor(Math.random() * 2000),
        repair: false,
      };
    }
    // Unknown subtypes (error_max_turns, error_max_budget_usd, result_error,
    // ...): keep the previous behavior, one immediate fresh re-roll.
    return { subtype: err.subtype, retry: true, backoffMs: 0, repair: false };
  }
  return { subtype: "unknown", retry: true, backoffMs: 0, repair: false };
}

function repairSuffixFor(err: unknown): string | undefined {
  if (!(err instanceof AgentError) || err.subtype !== "schema_validation") {
    return undefined;
  }
  const snippet = clip(err.raw ?? "", 1500);
  return [
    "IMPORTANT: your previous response failed JSON validation.",
    `Validation error: ${clip(err.message, 600)}`,
    snippet ? `Your previous (invalid) output:\n${snippet}` : "",
    "Return ONLY the corrected JSON object matching the required schema. No prose, no code fences.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Retry decision table (total attempts bounded at 2 per call):
//   rate_limited                        -> never retried; surface the reset time.
//   aborted (caller cancelled)          -> never retried.
//   schema_validation                   -> one repair retry: Zod/parse errors plus
//                                          the invalid output snippet appended to
//                                          the prompt, corrected JSON only.
//   timeout / no_result / process_error -> one retry after 1-3s jittered backoff.
//   anything else                       -> one immediate fresh retry (previous
//                                          blind-re-roll behavior, kept for
//                                          unknown classes).
export async function runAgent<S extends z.ZodType>(
  input: AgentRunInput<S>,
): Promise<AgentRunResult<z.infer<S>>> {
  let lastErr: unknown;
  let attemptsMade = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const repair = attempt > 1 ? repairSuffixFor(lastErr) : undefined;
      return await runOnce(input, repair);
    } catch (err) {
      lastErr = err;
      attemptsMade = attempt;
      const plan = planRetry(err);
      // The langfuse wrapper has no dedicated error/event API (and its public
      // API is frozen), so a failed attempt is recorded through the same
      // generation call with an error payload as the output. Best-effort and
      // non-blocking like all tracing; zero cost/usage since nothing landed.
      traceAgent({
        agent: input.agent,
        model: input.model,
        costUsd: 0,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        durationMs: 0,
        sessionId: input.groupId ?? "",
        input: input.user,
        output: {
          error: err instanceof Error ? err.message : String(err),
          subtype: plan.subtype,
          attempt,
          willRetry: plan.retry && attempt < 2,
        },
      });
      if (!plan.retry || attempt >= 2) break;
      if (plan.backoffMs > 0) await sleep(plan.backoffMs);
    }
  }
  // No Langfuse error API to lean on, so the attempt count rides on the thrown
  // message where the orchestrator and logs will show it.
  if (lastErr instanceof Error) {
    lastErr.message = `${lastErr.message} [attempts: ${attemptsMade}]`;
  }
  throw lastErr;
}
