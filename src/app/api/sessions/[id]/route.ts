import { NextResponse } from "next/server";
import { DomainError, getSessionState } from "@/orchestrator/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resume snapshot: the current open question (or the stored report when done),
// so a browser refresh mid-assessment picks up where the candidate left off.
// Pure read; never generates questions or reports.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const state = await getSessionState(id);
    return NextResponse.json(state);
  } catch (err) {
    if (err instanceof DomainError && err.code === "session_not_found") {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: 404 },
      );
    }
    console.error(`[api/sessions/${id}] getSessionState failed:`, err);
    return NextResponse.json(
      { ok: false, error: "Could not load this session.", code: "internal_error" },
      { status: 500 },
    );
  }
}
