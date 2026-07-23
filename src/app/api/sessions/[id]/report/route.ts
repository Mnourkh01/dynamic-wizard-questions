import { NextResponse } from "next/server";
import { getSessionReport } from "@/orchestrator/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const report = await getSessionReport(id);
    if (!report) {
      return NextResponse.json(
        { ok: false, error: "This report is not ready yet." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error(`[api/sessions/${id}/report] failed:`, err);
    return NextResponse.json(
      { ok: false, error: "Could not load the report." },
      { status: 500 },
    );
  }
}
