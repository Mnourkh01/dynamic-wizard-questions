import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgent } from "@/agents/client";
import { prisma } from "@/db/client";

// Node runtime is required: the Agent SDK spawns the `claude` CLI child process,
// which cannot run on the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SmokeSchema = z.object({
  language: z.string(),
  level: z.number().int().min(1).max(10),
  reason: z.string(),
});

// Phase 0 foundation spike: proves the whole risky integration in one request.
// The SDK spawns `claude` from a real Next Node route, on subscription auth (no
// API key), with tools disabled, and returns schema-validated JSON. Then it
// writes a row to SQLite. If this is green, everything else builds on solid ground.
export async function GET() {
  try {
    const agent = await runAgent({
      agent: "smoke",
      model: "sonnet",
      system:
        "You classify code snippets. Identify the programming language and rate how hard the snippet is to understand on a 1-10 scale. Answer only through the provided JSON schema.",
      user:
        'Classify this snippet:\n```\npublic class A { public static void main(String[] a){ System.out.println("hi"); } }\n```',
      schema: SmokeSchema,
      maxOutputTokens: 500,
      maxBudgetUsd: 0.2,
    });

    const session = await prisma.session.create({
      data: { role: "__smoke__", status: "abandoned", language: "en" },
    });

    return NextResponse.json({
      ok: true,
      agent: agent.data,
      costUsd: agent.costUsd,
      durationMs: agent.durationMs,
      dbRowId: session.id,
      // Proof the parent process carried no billed key (subscription auth used).
      apiKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
