import { NextResponse } from "next/server";
import { z } from "zod";
import { submitAnswer } from "@/orchestrator/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.object({
  questionId: z.string().min(1),
  answer: z.string().max(20000),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid answer payload." }, { status: 400 });
  }

  try {
    const result = await submitAnswer({
      sessionId: id,
      questionId: parsed.data.questionId,
      answer: parsed.data.answer,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error(`[api/sessions/${id}/answer] submitAnswer failed:`, err);
    return NextResponse.json(
      { ok: false, error: "Could not grade this answer. Please try again." },
      { status: 500 },
    );
  }
}
