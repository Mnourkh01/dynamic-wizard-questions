"use client";

import { gsap } from "gsap";
import { ArrowLeft, ArrowRight, Link2, Loader2, RotateCcw, Waves } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnswerField } from "@/components/AnswerField";
import { DepthField } from "@/components/DepthField";
import { DepthGauge } from "@/components/DepthGauge";
import { ResultPanel } from "@/components/ResultPanel";
import { dirFor, ROLE_PRESETS, specializationsFor, UI, type UILang } from "@/lib/i18n";
import type { AnswerResult, QuestionPayload, SessionReport, StartResult } from "@/lib/types";

type Phase = "setup" | "question" | "result";
type Busy = false | "starting" | "grading";

export default function Home() {
  const [lang, setLang] = useState<UILang>("en");
  const t = UI[lang];

  const [phase, setPhase] = useState<Phase>("setup");
  const [busy, setBusy] = useState<Busy>(false);
  const [error, setError] = useState<string | null>(null);

  // Setup form (two steps: role, then focus + name).
  const [setupStep, setSetupStep] = useState<"role" | "focus">("role");
  const [role, setRole] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [specChoice, setSpecChoice] = useState<string | null>(null); // null = general
  const [customSpec, setCustomSpec] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [showPersona, setShowPersona] = useState(false);
  const [years, setYears] = useState("");
  const [background, setBackground] = useState("");

  // Live session.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [current, setCurrent] = useState<QuestionPayload | null>(null);
  const [answer, setAnswer] = useState("");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
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

  // Step 1 -> step 2. Role must be valid before choosing a focus.
  const goToFocus = useCallback(() => {
    if (role.trim().length < 2) {
      setError(t.errorGeneric);
      return;
    }
    setError(null);
    setSetupStep("focus");
  }, [role, t]);

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
      // null choice = general (no specialization); "__other__" = the typed value.
      const specialization =
        specChoice === null
          ? undefined
          : specChoice === "__other__"
            ? customSpec.trim() || undefined
            : specChoice;
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: role.trim(),
          specialization,
          candidateName: candidateName.trim() || undefined,
          persona,
          language: lang,
        }),
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
      setSelectedOption(null);
      setPhase("question");
    } catch {
      setError(t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }, [role, specChoice, customSpec, candidateName, showPersona, years, background, lang, t]);

  const submit = useCallback(async () => {
    if (!sessionId || !current || busy) return;
    // MCQ answers are the 0-based selected option index; text answers are prose.
    if (current.format === "mcq" && selectedOption === null) return;
    const payloadAnswer =
      current.format === "mcq" ? String(selectedOption) : answer;
    setBusy("grading");
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId: current.questionId, answer: payloadAnswer }),
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
        setSelectedOption(null);
      }
    } catch {
      setError(t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }, [sessionId, current, answer, selectedOption, busy, t]);

  const restart = useCallback(() => {
    setPhase("setup");
    setSetupStep("role");
    setRole("");
    setCustomMode(false);
    setSpecChoice(null);
    setCustomSpec("");
    setCandidateName("");
    setYears("");
    setBackground("");
    setShowPersona(false);
    setSessionId(null);
    setCurrent(null);
    setAnswer("");
    setSelectedOption(null);
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

  // Shared pill style for the role/focus chips (amber when active).
  const chipStyle = (active: boolean) => ({
    border: `1px solid ${active ? "var(--amber)" : "var(--glass-border)"}`,
    background: active ? "rgba(255,180,84,0.14)" : "transparent",
    color: active ? "var(--text-hi)" : "var(--text-mid)",
  });

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
                  {setupStep === "role" ? t.setupTitle : t.step2Title}
                </h1>
                <p className="mt-3 text-sm" style={{ color: "var(--text-mid)" }}>
                  {setupStep === "role" ? t.setupHint : t.step2Hint}
                </p>

                {/* STEP 1: ROLE */}
                {setupStep === "role" && (
                  <div className="mt-8 text-start">
                    <p className="text-xs uppercase tracking-widest" style={{ color: "var(--text-low)" }}>
                      {t.roleLabel}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {ROLE_PRESETS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => {
                            setCustomMode(false);
                            setRole(r);
                            setSpecChoice(null);
                            setCustomSpec("");
                          }}
                          className="rounded-full px-4 py-2 text-sm transition-colors"
                          style={chipStyle(!customMode && role === r)}
                        >
                          {r}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setCustomMode(true);
                          setRole("");
                          setSpecChoice(null);
                          setCustomSpec("");
                        }}
                        className="rounded-full px-4 py-2 text-sm transition-colors"
                        style={chipStyle(customMode)}
                      >
                        {t.otherRole}
                      </button>
                    </div>

                    {customMode && (
                      <input
                        id="role"
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && goToFocus()}
                        placeholder={t.rolePlaceholder}
                        dir="auto"
                        aria-label={t.rolePlaceholder}
                        className="mt-3 w-full rounded-2xl px-5 py-4 text-[15px] outline-none"
                        style={{ background: "rgba(3,10,16,0.4)", border: "1px solid var(--glass-border)", color: "var(--text-hi)" }}
                      />
                    )}

                    <div className="mt-8 flex justify-center">
                      <button
                        type="button"
                        onClick={goToFocus}
                        disabled={role.trim().length < 2}
                        className="inline-flex items-center gap-2 rounded-full px-7 py-3 text-[15px] font-medium transition-transform hover:scale-[1.02] disabled:opacity-60"
                        style={{ background: "var(--amber)", color: "#241300" }}
                      >
                        {t.next} <ArrowRight size={18} aria-hidden />
                      </button>
                    </div>
                  </div>
                )}

                {/* STEP 2: FOCUS + NAME */}
                {setupStep === "focus" && (
                  <div className="mt-8 text-start">
                    <p className="text-xs uppercase tracking-widest" style={{ color: "var(--text-low)" }}>
                      {t.specializationLabel}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSpecChoice(null)}
                        className="rounded-full px-4 py-2 text-sm transition-colors"
                        style={chipStyle(specChoice === null)}
                      >
                        {t.generalFocus}
                      </button>
                      {specializationsFor(role).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSpecChoice(s)}
                          className="rounded-full px-4 py-2 text-sm transition-colors"
                          style={chipStyle(specChoice === s)}
                        >
                          {s}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setSpecChoice("__other__")}
                        className="rounded-full px-4 py-2 text-sm transition-colors"
                        style={chipStyle(specChoice === "__other__")}
                      >
                        {t.otherRole}
                      </button>
                    </div>

                    {specChoice === "__other__" && (
                      <input
                        value={customSpec}
                        onChange={(e) => setCustomSpec(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && start()}
                        placeholder={t.specializationOtherPlaceholder}
                        dir="auto"
                        aria-label={t.specializationLabel}
                        className="mt-3 w-full rounded-2xl px-5 py-4 text-[15px] outline-none"
                        style={{ background: "rgba(3,10,16,0.4)", border: "1px solid var(--glass-border)", color: "var(--text-hi)" }}
                      />
                    )}

                    <p className="mt-6 text-xs uppercase tracking-widest" style={{ color: "var(--text-low)" }}>
                      {t.nameLabel}
                    </p>
                    <input
                      value={candidateName}
                      onChange={(e) => setCandidateName(e.target.value)}
                      placeholder={t.namePlaceholder}
                      dir="auto"
                      aria-label={t.nameLabel}
                      className="mt-2 w-full rounded-2xl px-5 py-4 text-[15px] outline-none"
                      style={{ background: "rgba(3,10,16,0.4)", border: "1px solid var(--glass-border)", color: "var(--text-hi)" }}
                    />

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

                    <div className="mt-8 flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSetupStep("role");
                          setError(null);
                        }}
                        className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm transition-colors"
                        style={{ border: "1px solid var(--glass-border)", color: "var(--text-mid)" }}
                      >
                        <ArrowLeft size={16} aria-hidden /> {t.back}
                      </button>
                      <button
                        type="button"
                        onClick={start}
                        disabled={busy !== false || role.trim().length < 2}
                        className="inline-flex items-center gap-2 rounded-full px-7 py-3 text-[15px] font-medium transition-transform hover:scale-[1.02] disabled:opacity-60"
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
                    </div>
                  </div>
                )}

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
                    {current.format === "mcq" && current.options ? (
                      <ul className="grid gap-2.5">
                        {current.options.map((opt, i) => {
                          const selected = selectedOption === i;
                          return (
                            <li key={i}>
                              <button
                                type="button"
                                onClick={() => setSelectedOption(i)}
                                disabled={busy !== false}
                                aria-pressed={selected}
                                className="flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-start text-[15px] transition-colors disabled:opacity-60"
                                style={{
                                  border: `1px solid ${selected ? "var(--amber)" : "var(--glass-border)"}`,
                                  background: selected ? "rgba(255,180,84,0.14)" : "rgba(3,10,16,0.4)",
                                  color: selected ? "var(--text-hi)" : "var(--text-mid)",
                                }}
                              >
                                <span
                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
                                  style={{
                                    border: `1px solid ${selected ? "var(--amber)" : "var(--glass-border)"}`,
                                    color: selected ? "var(--amber)" : "var(--text-low)",
                                    fontFamily: "var(--font-mono)",
                                  }}
                                >
                                  {String.fromCharCode(65 + i)}
                                </span>
                                <span className="min-w-0">{opt}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <AnswerField
                        value={answer}
                        onChange={setAnswer}
                        onSubmit={submit}
                        placeholder={t.answerPlaceholder}
                        label={t.answerPlaceholder}
                        disabled={busy !== false}
                      />
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs" style={{ color: "var(--text-low)", fontFamily: "var(--font-mono)" }}>
                      {current.format === "mcq" ? t.chooseHint : t.submitHint}
                    </span>
                    <button
                      type="button"
                      onClick={submit}
                      disabled={
                        busy !== false ||
                        (current.format === "mcq"
                          ? selectedOption === null
                          : answer.trim().length === 0)
                      }
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
