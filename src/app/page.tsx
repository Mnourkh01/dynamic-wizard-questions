"use client";

import { gsap } from "gsap";
import { ArrowRight, Link2, Loader2, RotateCcw, Waves } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnswerField } from "@/components/AnswerField";
import { DepthField } from "@/components/DepthField";
import { DepthGauge } from "@/components/DepthGauge";
import { ResultPanel } from "@/components/ResultPanel";
import { dirFor, ROLE_PRESETS, UI, type UILang } from "@/lib/i18n";
import type { AnswerResult, QuestionPayload, SessionReport, StartResult } from "@/lib/types";

type Phase = "setup" | "question" | "result";
type Busy = false | "starting" | "grading";

export default function Home() {
  const [lang, setLang] = useState<UILang>("en");
  const t = UI[lang];

  const [phase, setPhase] = useState<Phase>("setup");
  const [busy, setBusy] = useState<Busy>(false);
  const [error, setError] = useState<string | null>(null);

  // Setup form.
  const [role, setRole] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [showPersona, setShowPersona] = useState(false);
  const [years, setYears] = useState("");
  const [background, setBackground] = useState("");

  // Live session.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [current, setCurrent] = useState<QuestionPayload | null>(null);
  const [answer, setAnswer] = useState("");
  const [pulse, setPulse] = useState(false);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [copied, setCopied] = useState(false);

  const questionRef = useRef<HTMLDivElement>(null);

  // Keep the document language + direction in sync with the toggle.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirFor(lang);
  }, [lang]);

  // Refocus the lens: blur-and-rise each new question in (static if reduced motion).
  useEffect(() => {
    if (phase !== "question" || !current || !questionRef.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        questionRef.current,
        { opacity: 0, y: 16, filter: "blur(10px)" },
        { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.6, ease: "power3.out" },
      );
    });
    return () => ctx.revert();
  }, [current, phase]);

  const gaugeLevel = current?.difficulty ?? 0;

  const start = useCallback(async () => {
    if (role.trim().length < 2) {
      setError(t.errorGeneric);
      return;
    }
    setError(null);
    setBusy("starting");
    try {
      const persona = showPersona
        ? {
            years: years ? Number(years) : undefined,
            background: background.trim() || undefined,
          }
        : undefined;
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: role.trim(), persona, language: lang }),
      });
      const data = (await res.json()) as StartResult & { error?: string };
      if (!res.ok || !data.ok) {
        setError(("error" in data && data.error) || t.errorGeneric);
        setBusy(false);
        return;
      }
      setSessionId(data.sessionId);
      setCurrent(data.question);
      setAnswer("");
      setPhase("question");
    } catch {
      setError(t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }, [role, showPersona, years, background, lang, t]);

  const submit = useCallback(async () => {
    if (!sessionId || !current || busy) return;
    setBusy("grading");
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId: current.questionId, answer }),
      });
      const data = (await res.json()) as AnswerResult & { error?: string };
      if (!res.ok || "error" in data) {
        setError(("error" in data && data.error) || t.errorGeneric);
        setBusy(false);
        return;
      }
      setPulse(true);
      setTimeout(() => setPulse(false), 950);
      if (data.done) {
        setReport(data.report);
        setPhase("result");
      } else {
        setCurrent(data.question);
        setAnswer("");
      }
    } catch {
      setError(t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }, [sessionId, current, answer, busy, t]);

  const restart = useCallback(() => {
    setPhase("setup");
    setRole("");
    setCustomMode(false);
    setYears("");
    setBackground("");
    setShowPersona(false);
    setSessionId(null);
    setCurrent(null);
    setAnswer("");
    setReport(null);
    setError(null);
  }, []);

  const copyLink = useCallback(() => {
    if (!sessionId) return;
    void navigator.clipboard.writeText(`${window.location.origin}/report/${sessionId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [sessionId]);

  const busyLabel = busy === "starting" ? t.starting : t.grading;

  return (
    <>
      <DepthField level={gaugeLevel} active={phase !== "result"} />

      <main className="mx-auto flex min-h-dvh max-w-4xl flex-col px-5 py-6">
        <nav className="flex items-center justify-between">
          <span className="flex items-center gap-2" style={{ color: "var(--text-hi)" }}>
            <Waves size={20} style={{ color: "var(--amber)" }} aria-hidden />
            <span style={{ fontFamily: "var(--font-display)" }} className="text-lg">
              {t.appName}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setLang((l) => (l === "en" ? "ar" : "en"))}
            className="rounded-full px-3 py-1.5 text-sm transition-colors"
            style={{ border: "1px solid var(--glass-border)", color: "var(--text-mid)" }}
          >
            {t.langToggle}
          </button>
        </nav>

        <div className="flex flex-1 items-center justify-center py-8">
          <section className="lens w-full p-7 sm:p-10" aria-live="polite">
            {/* SETUP */}
            {phase === "setup" && (
              <div className="rise-in mx-auto max-w-xl text-center">
                <p className="text-xs uppercase tracking-[0.3em]" style={{ color: "var(--text-low)" }}>
                  {t.tagline}
                </p>
                <h1
                  className="mt-4 text-3xl sm:text-4xl"
                  style={{ fontFamily: "var(--font-display)", color: "var(--text-hi)" }}
                >
                  {t.setupTitle}
                </h1>
                <p className="mt-3 text-sm" style={{ color: "var(--text-mid)" }}>
                  {t.setupHint}
                </p>

                <div className="mt-8 text-start">
                  <p className="text-xs uppercase tracking-widest" style={{ color: "var(--text-low)" }}>
                    {t.roleLabel}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {ROLE_PRESETS.map((r) => {
                      const selected = !customMode && role === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => {
                            setCustomMode(false);
                            setRole(r);
                          }}
                          className="rounded-full px-4 py-2 text-sm transition-colors"
                          style={{
                            border: `1px solid ${selected ? "var(--amber)" : "var(--glass-border)"}`,
                            background: selected ? "rgba(255,180,84,0.14)" : "transparent",
                            color: selected ? "var(--text-hi)" : "var(--text-mid)",
                          }}
                        >
                          {r}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        setCustomMode(true);
                        setRole("");
                      }}
                      className="rounded-full px-4 py-2 text-sm transition-colors"
                      style={{
                        border: `1px solid ${customMode ? "var(--amber)" : "var(--glass-border)"}`,
                        background: customMode ? "rgba(255,180,84,0.14)" : "transparent",
                        color: customMode ? "var(--text-hi)" : "var(--text-mid)",
                      }}
                    >
                      {t.otherRole}
                    </button>
                  </div>

                  {customMode && (
                    <input
                      id="role"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && start()}
                      placeholder={t.rolePlaceholder}
                      dir="auto"
                      aria-label={t.rolePlaceholder}
                      className="mt-3 w-full rounded-2xl px-5 py-4 text-[15px] outline-none"
                      style={{ background: "rgba(3,10,16,0.4)", border: "1px solid var(--glass-border)", color: "var(--text-hi)" }}
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => setShowPersona((s) => !s)}
                    className="mt-3 text-sm underline-offset-4 hover:underline"
                    style={{ color: "var(--text-low)" }}
                  >
                    {t.personaToggle}
                  </button>

                  {showPersona && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr]">
                      <input
                        aria-label={t.yearsLabel}
                        value={years}
                        onChange={(e) => setYears(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder={t.yearsLabel}
                        inputMode="numeric"
                        className="rounded-2xl px-4 py-3 text-sm outline-none"
                        style={{ background: "rgba(3,10,16,0.4)", border: "1px solid var(--glass-border)", color: "var(--text-hi)" }}
                      />
                      <input
                        aria-label={t.backgroundLabel}
                        value={background}
                        onChange={(e) => setBackground(e.target.value)}
                        placeholder={t.backgroundPlaceholder}
                        dir="auto"
                        className="rounded-2xl px-4 py-3 text-sm outline-none"
                        style={{ background: "rgba(3,10,16,0.4)", border: "1px solid var(--glass-border)", color: "var(--text-hi)" }}
                      />
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={start}
                  disabled={busy !== false || role.trim().length < 2}
                  className="mt-8 inline-flex items-center gap-2 rounded-full px-7 py-3 text-[15px] font-medium transition-transform hover:scale-[1.02] disabled:opacity-60"
                  style={{ background: "var(--amber)", color: "#241300" }}
                >
                  {busy === "starting" ? (
                    <>
                      <Loader2 size={18} className="animate-spin" aria-hidden /> {t.starting}
                    </>
                  ) : (
                    <>
                      {t.start} <ArrowRight size={18} aria-hidden />
                    </>
                  )}
                </button>

                {error && (
                  <p className="mt-4 text-sm" style={{ color: "var(--amber-soft)" }} role="alert">
                    {error}
                  </p>
                )}
              </div>
            )}

            {/* QUESTION */}
            {phase === "question" && current && (
              <div className="flex gap-8">
                <div className="hidden md:flex md:items-center">
                  <DepthGauge level={gaugeLevel} levelWord={t.levelWord} pulse={pulse} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between text-xs uppercase tracking-widest" style={{ color: "var(--text-low)" }}>
                    <span>
                      {t.topicPrefix} · {current.topicName}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>
                      {current.discovery
                        ? t.warmup
                        : current.ceilingProbe
                          ? t.ceilingProbe
                          : t.questionCounter(current.order)}
                    </span>
                  </div>

                  <div ref={questionRef}>
                    <p
                      className="mt-5 whitespace-pre-line text-xl leading-relaxed sm:text-2xl"
                      style={{ fontFamily: "var(--font-display)", color: "var(--text-hi)" }}
                    >
                      {current.text}
                    </p>
                  </div>

                  <div className="mt-6">
                    <AnswerField
                      value={answer}
                      onChange={setAnswer}
                      onSubmit={submit}
                      placeholder={t.answerPlaceholder}
                      label={t.answerPlaceholder}
                      disabled={busy !== false}
                    />
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs" style={{ color: "var(--text-low)", fontFamily: "var(--font-mono)" }}>
                      {t.submitHint}
                    </span>
                    <button
                      type="button"
                      onClick={submit}
                      disabled={busy !== false || answer.trim().length === 0}
                      className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-medium transition-transform hover:scale-[1.02] disabled:opacity-60"
                      style={{ background: "var(--amber)", color: "#241300" }}
                    >
                      {busy === "grading" ? (
                        <>
                          <Loader2 size={16} className="animate-spin" aria-hidden /> {busyLabel}
                        </>
                      ) : (
                        <>
                          {t.submit} <ArrowRight size={16} aria-hidden />
                        </>
                      )}
                    </button>
                  </div>

                  {error && (
                    <p className="mt-3 text-sm" style={{ color: "var(--amber-soft)" }} role="alert">
                      {error}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* RESULT */}
            {phase === "result" && report && (
              <div className="rise-in">
                <ResultPanel report={report} t={t} />
                <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={restart}
                    className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm transition-transform hover:scale-[1.02]"
                    style={{ background: "var(--amber)", color: "#241300" }}
                  >
                    <RotateCcw size={16} aria-hidden /> {t.restart}
                  </button>
                  <button
                    type="button"
                    onClick={copyLink}
                    className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm transition-colors"
                    style={{ border: "1px solid var(--glass-border)", color: "var(--text-mid)" }}
                  >
                    <Link2 size={16} aria-hidden /> {copied ? t.copied : t.copyLink}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
