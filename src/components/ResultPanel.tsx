import type { UIStrings } from "@/lib/i18n";
import type { SessionReport } from "@/lib/types";
import { TopicColumns } from "./DepthGauge";

// Presentational report body, shared by the live wizard result state and the SSR
// permalink page. No hooks, so it renders on the server too.
export function ResultPanel({ report, t }: { report: SessionReport; t: UIStrings }) {
  return (
    <div className="flex flex-col gap-12">
      <header className="text-center">
        <span
          className="inline-block rounded-full px-3 py-1 text-[11px] uppercase tracking-widest"
          style={{ border: "1px solid var(--glass-border)", color: "var(--text-mid)" }}
        >
          {t.selfAssessment}
        </span>
        {report.candidateName && (
          <p
            className="mt-4 text-lg"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-hi)" }}
          >
            {t.assessmentFor} {report.candidateName}
          </p>
        )}
        {report.role && (
          <p className="mt-2 text-xs uppercase tracking-widest" style={{ color: "var(--text-low)" }}>
            {report.role}
            {report.specialization ? ` · ${report.specialization}` : ""}
          </p>
        )}
        <div className="mt-6 flex items-end justify-center gap-2">
          <span
            className="text-7xl leading-none sm:text-8xl"
            style={{ fontFamily: "var(--font-mono)", color: "var(--text-hi)" }}
          >
            {report.total}
          </span>
          <span className="mb-2 text-lg" style={{ color: "var(--text-low)" }}>
            {t.outOf}
          </span>
        </div>
        <p className="mt-3 text-sm" style={{ color: "var(--text-mid)" }}>
          <span style={{ color: "var(--amber)" }}>{report.overallLabel}</span>
          {"  "}
          <span style={{ fontFamily: "var(--font-mono)" }}>± {report.confidenceInterval}</span>
        </p>
        {report.verdict && (
          <p
            className="mx-auto mt-5 max-w-2xl text-[15px] leading-relaxed"
            style={{ color: "var(--text-hi)" }}
          >
            {report.verdict}
          </p>
        )}
      </header>

      <TopicColumns
        topics={report.topics.map((tp) => ({
          name: tp.name,
          theta: tp.theta,
          points: tp.points,
          label: tp.label,
        }))}
      />

      <p
        className="mx-auto max-w-2xl text-center text-[15px] leading-relaxed"
        style={{ color: "var(--text-mid)" }}
      >
        {report.summary}
      </p>

      {report.weakPoints && report.weakPoints.length > 0 && (
        <section>
          <h2
            className="text-center text-sm uppercase tracking-widest"
            style={{ color: "var(--amber)" }}
          >
            {t.weakPointsLabel}
          </h2>
          <ul className="mx-auto mt-4 max-w-2xl space-y-3">
            {report.weakPoints.map((w, i) => (
              <li key={i} className="flex gap-4">
                <span
                  className="shrink-0 text-sm"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--amber)" }}
                >
                  {(i + 1).toString().padStart(2, "0")}
                </span>
                <span className="text-[15px] leading-relaxed" style={{ color: "var(--text-mid)" }}>
                  <strong style={{ color: "var(--text-hi)" }}>{w.area}.</strong> {w.issue}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {report.perTopic.map((topic) => (
          <article
            key={topic.name}
            className="rounded-2xl p-5"
            style={{ border: "1px solid var(--glass-border)", background: "rgba(3,10,16,0.3)" }}
          >
            <h3 className="text-base" style={{ fontFamily: "var(--font-display)", color: "var(--text-hi)" }}>
              {topic.name}
            </h3>
            {topic.strengths.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] uppercase tracking-widest" style={{ color: "var(--teal-400)" }}>
                  {t.strengths}
                </p>
                <ul className="mt-1 space-y-1 text-sm" style={{ color: "var(--text-mid)" }}>
                  {topic.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {topic.gaps.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] uppercase tracking-widest" style={{ color: "var(--amber)" }}>
                  {t.gaps}
                </p>
                <ul className="mt-1 space-y-1 text-sm" style={{ color: "var(--text-mid)" }}>
                  {topic.gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        ))}
      </div>

      <section>
        <h2
          className="text-center text-sm uppercase tracking-widest"
          style={{ color: "var(--text-low)" }}
        >
          {t.learningPath}
        </h2>
        <ol className="mx-auto mt-4 max-w-2xl space-y-3">
          {report.learningPath.map((step, i) => (
            <li key={i} className="flex gap-4">
              <span
                className="shrink-0 text-sm"
                style={{ fontFamily: "var(--font-mono)", color: "var(--amber)" }}
              >
                {(i + 1).toString().padStart(2, "0")}
              </span>
              <span className="text-[15px] leading-relaxed" style={{ color: "var(--text-mid)" }}>
                {step}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
