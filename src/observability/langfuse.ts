// Non-blocking observability. If Langfuse keys are absent, or the client throws
// for any reason, tracing silently no-ops. It must never break or slow an
// assessment, so every path here is wrapped and failure-tolerant.
import { Langfuse } from "langfuse";

export interface AgentTrace {
  agent: string;
  model: string;
  costUsd: number;
  durationMs: number;
  sessionId: string;
  input: string;
  output: unknown;
}

// undefined = not yet resolved, null = resolved-to-disabled.
let client: Langfuse | null | undefined;

function getClient(): Langfuse | null {
  if (client !== undefined) return client;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    client = null;
    return null;
  }
  try {
    client = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: process.env.LANGFUSE_BASEURL,
    });
  } catch {
    client = null;
  }
  return client;
}

export function traceAgent(trace: AgentTrace): void {
  try {
    const c = getClient();
    if (!c) return;
    const t = c.trace({ name: `agent:${trace.agent}`, sessionId: trace.sessionId });
    t.generation({
      name: trace.agent,
      model: trace.model,
      input: trace.input,
      output: trace.output,
      metadata: { costUsd: trace.costUsd, durationMs: trace.durationMs },
    });
  } catch {
    // best-effort only
  }
}
