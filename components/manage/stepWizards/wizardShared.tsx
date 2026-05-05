"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/* ------------------------------------------------------------------------- */
/* Pure helpers (existing API kept identical for back-compat)                */
/* ------------------------------------------------------------------------- */

export function notesToText(n?: string[]): string {
  return (n ?? []).join("\n");
}

export function textToNotes(t: string): string[] | undefined {
  const lines = t.split("\n").map((s) => s.trimEnd());
  const nonEmpty = lines.filter((s) => s.length > 0);
  return nonEmpty.length ? nonEmpty : undefined;
}

/** Append a picked place line to an interval `comment` (OSM / geocode audit trail). */
export function appendGeoPickComment(prev: string | undefined, line: string): string {
  const t = (prev ?? "").trim();
  return t ? `${t}\n${line}` : line;
}

/* ------------------------------------------------------------------------- */
/* Shared wizard UI primitives — big, friendly inputs with consistent rhythm */
/* ------------------------------------------------------------------------- */

export type WizardAccent = "violet" | "sky" | "emerald" | "zinc";

const ACCENT_TEXT: Record<WizardAccent, string> = {
  violet: "text-violet-600 dark:text-violet-400",
  sky: "text-sky-600 dark:text-sky-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  zinc: "text-zinc-600 dark:text-zinc-300",
};

const ACCENT_DOT_ACTIVE: Record<WizardAccent, string> = {
  violet: "bg-violet-500",
  sky: "bg-sky-500",
  emerald: "bg-emerald-500",
  zinc: "bg-zinc-500",
};

const ACCENT_PRIMARY_BTN: Record<WizardAccent, string> = {
  violet:
    "bg-violet-600 hover:bg-violet-700 shadow-violet-600/20 hover:shadow-violet-600/30 dark:bg-violet-500 dark:hover:bg-violet-400",
  sky: "bg-sky-600 hover:bg-sky-700 shadow-sky-600/20 hover:shadow-sky-600/30 dark:bg-sky-500 dark:hover:bg-sky-400",
  emerald:
    "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20 hover:shadow-emerald-600/30 dark:bg-emerald-500 dark:hover:bg-emerald-400",
  zinc: "bg-zinc-900 hover:bg-zinc-800 shadow-zinc-900/10 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100",
};

/** Big two-tone bordered input. Shared across panels for consistent rhythm. */
export const WIZARD_INPUT_CLASS =
  "w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 py-3 text-base font-medium text-zinc-900 placeholder:text-zinc-400 transition focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/15 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500";

export const WIZARD_INPUT_CLASS_LARGE =
  "w-full rounded-2xl border-2 border-zinc-200 bg-white px-5 py-4 text-lg font-medium text-zinc-900 placeholder:text-zinc-400 transition focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/15 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500";

export const WIZARD_TEXTAREA_CLASS =
  "w-full resize-y rounded-2xl border-2 border-zinc-200 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 transition focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/15 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500";

export const WIZARD_SELECT_CLASS =
  "w-full appearance-none rounded-2xl border-2 border-zinc-200 bg-white bg-[length:1.25rem] bg-[right_1rem_center] bg-no-repeat px-4 py-3 pe-10 text-base font-medium text-zinc-900 transition focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/15 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50";

/** Header block: small accent eyebrow, big title, helpful subtitle. */
export function WizardPageHeading({
  eyebrow,
  title,
  subtitle,
  accent = "violet",
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  accent?: WizardAccent;
}) {
  return (
    <div className="space-y-1.5">
      {eyebrow ? (
        <p
          className={`text-[11px] font-semibold uppercase tracking-wider ${ACCENT_TEXT[accent]}`}
        >
          {eyebrow}
        </p>
      ) : null}
      <h3 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {title}
      </h3>
      {subtitle ? (
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

/** Field wrapper: bold label + optional badge + input slot + help text. */
export function WizardField({
  label,
  htmlFor,
  optional,
  hint,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  optional?: boolean;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={htmlFor}
          className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100"
        >
          {label}
        </label>
        {optional ? (
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Optional
          </span>
        ) : null}
      </div>
      {children}
      {hint ? (
        <p className="text-xs leading-snug text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
    </div>
  );
}

/** Field wrapper that places the input visually inside a bordered card with a help footer. */
export function WizardSection({
  title,
  hint,
  children,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      {title ? (
        <p className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {title}
        </p>
      ) : null}
      <div className="space-y-3">{children}</div>
      {hint ? (
        <p className="mt-3 text-xs leading-snug text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
    </div>
  );
}

/** Track forward/back direction across `step` changes for slide animations. */
export function useWizardDirection(step: number): "forward" | "back" {
  const prev = useRef(step);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  useEffect(() => {
    if (step > prev.current) setDirection("forward");
    else if (step < prev.current) setDirection("back");
    prev.current = step;
  }, [step]);
  return direction;
}

/** Wrap each panel page in this so the slide animation re-triggers on `key={page}`. */
export function WizardPage({
  pageKey,
  direction,
  children,
}: {
  pageKey: string | number;
  direction: "forward" | "back";
  children: ReactNode;
}) {
  const cls =
    direction === "forward" ? "wizard-slide-in-forward" : "wizard-slide-in-back";
  return (
    <div key={pageKey} className={cls}>
      {children}
    </div>
  );
}

/** Animated progress dots, accent-aware. */
export function WizardProgressDots({
  current,
  total,
  accent = "violet",
}: {
  current: number;
  total: number;
  accent?: WizardAccent;
}) {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      {Array.from({ length: total }, (_, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return (
          <span
            key={i}
            className={
              "h-1.5 flex-1 rounded-full transition-all duration-500 " +
              (state === "done"
                ? ACCENT_DOT_ACTIVE[accent]
                : state === "active"
                  ? `${ACCENT_DOT_ACTIVE[accent]} wizard-progress-pulse`
                  : "bg-zinc-200 dark:bg-zinc-800")
            }
          />
        );
      })}
    </div>
  );
}

/** Bottom row of nav buttons. Pass an explicit primary action label/handler for the last page. */
export function WizardNavRow({
  page,
  totalPages,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  finalAction,
  accent = "violet",
  prevDisabled,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
  /** Replaces the "Next →" button on the last page when set. */
  finalAction?: { label: string; onClick: () => void };
  accent?: WizardAccent;
  prevDisabled?: boolean;
}) {
  const isLast = page >= totalPages - 1;
  const showFinalAction = isLast && finalAction;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      <button
        type="button"
        disabled={prevDisabled}
        onClick={onPrev}
        className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <ChevronIcon dir="prev" />
        {prevLabel}
      </button>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalPages }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className={
              "h-1.5 w-6 rounded-full transition-all duration-300 " +
              (i <= page
                ? ACCENT_DOT_ACTIVE[accent]
                : "bg-zinc-200 dark:bg-zinc-800")
            }
          />
        ))}
      </div>
      {showFinalAction ? (
        <button
          type="button"
          onClick={finalAction.onClick}
          className={`group inline-flex items-center gap-1.5 rounded-2xl px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition active:scale-[0.99] ${ACCENT_PRIMARY_BTN[accent]}`}
        >
          {finalAction.label}
          <ChevronIcon dir="next" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onNext}
          className={`group inline-flex items-center gap-1.5 rounded-2xl px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition active:scale-[0.99] ${ACCENT_PRIMARY_BTN[accent]}`}
        >
          {nextLabel}
          <ChevronIcon dir="next" />
        </button>
      )}
    </div>
  );
}

function ChevronIcon({ dir }: { dir: "prev" | "next" }) {
  return (
    <svg
      className="h-4 w-4 transition group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {dir === "prev" ? (
        <>
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        </>
      ) : (
        <>
          <path d="M5 12h14" />
          <path d="m13 5 7 7-7 7" />
        </>
      )}
    </svg>
  );
}
