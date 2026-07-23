"use client";

import { useMemo } from "react";

// Multiline answer input. Switches to a monospace face when the text looks like
// code, submits on Ctrl/Cmd + Enter, and is always labeled for screen readers.
export function AnswerField({
  value,
  onChange,
  onSubmit,
  placeholder,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  label: string;
  disabled: boolean;
}) {
  const looksLikeCode = useMemo(
    () => /[{};]|=>|\bfunction\b|\bconst\b|\bdef\b|\bclass\b|\bpublic\b|\bimport\b/.test(value),
    [value],
  );

  return (
    <div>
      <label htmlFor="answer-field" className="sr-only">
        {label}
      </label>
      <textarea
        id="answer-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        dir="auto"
        rows={7}
        className="w-full resize-none rounded-2xl px-5 py-4 text-[15px] leading-relaxed outline-none transition-colors disabled:opacity-50"
        style={{
          fontFamily: looksLikeCode ? "var(--font-mono)" : "inherit",
          background: "rgba(3,10,16,0.4)",
          border: "1px solid var(--glass-border)",
          color: "var(--text-hi)",
        }}
      />
    </div>
  );
}
