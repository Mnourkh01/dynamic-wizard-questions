import { NextResponse } from "next/server";
import { z } from "zod";
import { startSession } from "@/orchestrator/session";

// Node runtime: the orchestrator spawns the `claude` CLI. force-dynamic so the
// route always runs; maxDuration is a hint for hosts (local dev has no limit).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.object({
  role: z.string().min(2).max(200),
  persona: z
    .object({
      background: z.string().max(500).optional(),
      years: z.number().min(0).max(60).optional(),
    })
    .optional(),
  language: z.enum(["en", "ar"]).optional(),
});

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Please enter a valid role to assess." },
      { status: 400 },
    );
  }

  try {
    const result = await startSession(parsed.data);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/sessions] startSession failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not start the assessment. Please try again." },
      { status: 500 },
    );
  }
}
