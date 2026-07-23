"use client";

import { useEffect, useRef } from "react";

// The living depth field behind the lens. Its color deepens and its glow rises
// as `level` (0..10) climbs and the engine grows confident. CSS/SVG only in v1
// (the WebGL shader is deferred). Static under reduced motion; drift pauses when
// the tab is hidden so an idle tab burns nothing.
export function DepthField({ level, active }: { level: number; active: boolean }) {
  const driftRef = useRef<HTMLDivElement>(null);
  const depth = Math.max(0, Math.min(1, level / 10));

  useEffect(() => {
    const el = driftRef.current;
    if (!el) return;
    const onVisibility = () => {
      el.style.animationPlayState = document.hidden ? "paused" : "running";
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Teal-to-brighter-teal as depth rises; the field also lifts in opacity.
  const tealAlpha = 0.18 + depth * 0.34;
  const oceanAlpha = 0.14 + depth * 0.26;
  const beaconAlpha = 0.05 + depth * 0.16;

  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden" style={{ background: "var(--ink-900)" }}>
      <div
        ref={driftRef}
        className="absolute inset-[-10%]"
        style={{
          animation: active ? "field-drift 20s ease-in-out infinite" : "none",
          background: [
            `radial-gradient(60% 50% at 50% 78%, rgba(31,111,158,${oceanAlpha}) 0%, transparent 70%)`,
            `radial-gradient(55% 45% at 50% 62%, rgba(20,184,178,${tealAlpha}) 0%, transparent 68%)`,
            `radial-gradient(38% 30% at 50% 54%, rgba(255,180,84,${beaconAlpha}) 0%, transparent 60%)`,
          ].join(","),
        }}
      />
      {/* Depth vignette so the lens reads as floating in deep water. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 40%, transparent 45%, rgba(3,6,10,0.7) 100%)",
        }}
      />
    </div>
  );
}
