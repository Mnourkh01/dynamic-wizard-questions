import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DepthField } from "@/components/DepthField";
import { ResultPanel } from "@/components/ResultPanel";
import { UI } from "@/lib/i18n";
import { getSessionReport } from "@/orchestrator/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSR permalink for a finished assessment. Reads the persisted report from the
// DB (no agents run) so a result can be revisited or shared.
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getSessionReport(id);
  if (!report) notFound();

  const t = UI.en;

  return (
    <>
      <DepthField level={report.total / 100} active={false} />
      <main className="mx-auto flex min-h-dvh max-w-4xl flex-col px-5 py-6">
        <nav className="flex items-center justify-between">
          <span style={{ fontFamily: "var(--font-display)", color: "var(--text-hi)" }} className="text-lg">
            {t.appName}
          </span>
        </nav>
        <div className="flex flex-1 items-center justify-center py-8">
          <section className="lens w-full p-7 sm:p-10">
            <ResultPanel report={report} t={t} />
            <div className="mt-10 flex justify-center">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm transition-transform hover:scale-[1.02]"
                style={{ background: "var(--amber)", color: "#241300" }}
              >
                {t.restart} <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
