"use client";

// Depth gauges. The live gauge (a single amber column filling to the current
// estimated level) rides beside the question; the topic columns show the final
// 1000-point split as depth, one column per topic, instead of a generic radar.

function clampPct(level: number): number {
  return Math.max(0, Math.min(100, (level / 10) * 100));
}

// The live gauge shown during the question loop.
export function DepthGauge({
  level,
  levelWord,
  pulse,
}: {
  level: number;
  levelWord: string;
  pulse: boolean;
}) {
  const pct = clampPct(level);
  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="relative w-2.5 rounded-full"
        style={{ height: 240, background: "rgba(126,205,214,0.12)" }}
      >
        <div
          className="absolute inset-x-0 bottom-0 rounded-full"
          style={{
            height: `${pct}%`,
            background: "linear-gradient(180deg, var(--amber-soft), var(--amber))",
            boxShadow: "0 0 18px 1px rgba(255,180,84,0.55)",
            transition: "height var(--dur-slow) var(--ease-lens)",
            animation: pulse ? "beacon-pulse 900ms var(--ease-lens)" : "none",
          }}
        />
      </div>
      <div className="text-center">
        <div
          className="text-3xl leading-none"
          style={{ fontFamily: "var(--font-mono)", color: "var(--amber)" }}
        >
          {level.toFixed(1)}
        </div>
        <div className="mt-1 text-xs uppercase tracking-widest" style={{ color: "var(--text-low)" }}>
          {levelWord}
        </div>
      </div>
    </div>
  );
}

export interface TopicColumnData {
  name: string;
  theta: number;
  points: number;
  label: string;
}

export function TopicColumns({ topics }: { topics: TopicColumnData[] }) {
  return (
    <div className="flex flex-wrap items-end justify-center gap-x-6 gap-y-8 sm:gap-x-8">
      {topics.map((t) => {
        const pct = clampPct(t.theta);
        return (
          <div key={t.name} className="flex w-24 flex-col items-center gap-3">
            <div
              className="text-lg"
              style={{ fontFamily: "var(--font-mono)", color: "var(--amber)" }}
            >
              {t.points}
            </div>
            <div
              className="relative w-2.5 rounded-full"
              style={{ height: 170, background: "rgba(126,205,214,0.12)" }}
            >
              <div
                className="absolute inset-x-0 bottom-0 rounded-full"
                style={{
                  height: `${pct}%`,
                  background: "linear-gradient(180deg, var(--teal-400), var(--ocean-500))",
                  boxShadow: "0 0 14px 0 rgba(20,184,178,0.4)",
                  transition: "height var(--dur-slow) var(--ease-lens)",
                }}
              />
            </div>
            <div className="text-center">
              <div className="text-[13px] leading-tight" style={{ color: "var(--text-hi)" }}>
                {t.name}
              </div>
              <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-low)" }}>
                {t.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
