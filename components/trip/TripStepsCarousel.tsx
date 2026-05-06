"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import {
  StepIntervalsBlock,
  formatStepRange,
  kindLabel,
  stepEmoji,
  stepPlaceLine,
} from "@/components/trip/TripStepsDetailList";
import type { Destination, TripStep } from "@/lib/types/trip";

/**
 * Single-card "swipe through your steps" replacement for the long detail list.
 * Default-selects {@link emphasizedStepId} when provided (e.g. the current step).
 *
 * Nav cluster + dot indicator are wrapped in `dir="ltr"` so the prev/next pair
 * keeps its natural visual order under RTL locales (Hebrew). The emphasized
 * step shows a small "Now" pill so the carousel still communicates context.
 */
export function TripStepsCarousel({
  steps,
  destinations,
  emphasizedStepId,
}: {
  steps: TripStep[];
  destinations: Destination[];
  emphasizedStepId?: string | null;
}) {
  const { t } = useI18n();

  const initialIdx = useMemo(() => {
    if (!emphasizedStepId) return 0;
    const i = steps.findIndex((s) => s.id === emphasizedStepId);
    return i >= 0 ? i : 0;
  }, [steps, emphasizedStepId]);

  const [idx, setIdx] = useState(initialIdx);

  /** Snap into bounds when the steps array shrinks (e.g. step deleted while open). */
  useEffect(() => {
    setIdx((prev) => Math.min(prev, Math.max(0, steps.length - 1)));
  }, [steps.length]);

  /** Sync to emphasized step when phase/focus changes. */
  useEffect(() => {
    setIdx(initialIdx);
  }, [initialIdx]);

  if (steps.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("view.noStepsInManage")}</p>
    );
  }

  const total = steps.length;
  const safeIdx = Math.min(idx, total - 1);
  const step = steps[safeIdx]!;
  const goPrev = () => setIdx((i) => (i - 1 + total) % total);
  const goNext = () => setIdx((i) => (i + 1) % total);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div
        dir="ltr"
        className="flex items-center justify-between gap-2 border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-900"
      >
        <NavButton dir="prev" onClick={goPrev} ariaLabel={t("view.stepPrev")} />
        <p className="font-mono text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
          {safeIdx + 1} / {total}
        </p>
        <NavButton dir="next" onClick={goNext} ariaLabel={t("view.stepNext")} />
      </div>

      <div className="px-4 pb-4 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg leading-none" aria-hidden>
            {stepEmoji(step)}
          </span>
          <span className="rounded-full bg-zinc-100 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {kindLabel(step, t)}
          </span>
          {emphasizedStepId === step.id ? (
            <span className="rounded-full bg-violet-100 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:bg-violet-900/60 dark:text-violet-200">
              {t("view.nowLabel")}
            </span>
          ) : null}
        </div>
        <h3 className="mt-2 text-base font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
          {step.title.trim() || t("view.untitledStep")}
        </h3>
        <p className="mt-0.5 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
          {formatStepRange(step.startTime, step.endTime, t("view.emDash"))}
        </p>
        <p className="mt-0.5 truncate text-sm text-zinc-700 dark:text-zinc-300">
          {stepPlaceLine(step, destinations, t)}
        </p>
        <StepIntervalsBlock step={step} destinations={destinations} t={t} />
      </div>

      <div
        dir="ltr"
        className="flex flex-wrap items-center justify-center gap-1 border-t border-zinc-100 px-3 py-2 dark:border-zinc-900"
      >
        {steps.map((s, i) => {
          const active = i === safeIdx;
          return (
            <button
              type="button"
              key={s.id}
              onClick={() => setIdx(i)}
              aria-label={s.title || t("view.untitledStep")}
              aria-current={active ? "step" : undefined}
              className={`h-1.5 rounded-full transition ${
                active
                  ? "w-5 bg-violet-600 dark:bg-violet-400"
                  : "w-1.5 bg-zinc-300 hover:bg-zinc-400 dark:bg-zinc-700 dark:hover:bg-zinc-600"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

function NavButton({
  dir,
  onClick,
  ariaLabel,
}: {
  dir: "prev" | "next";
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 active:scale-95 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {dir === "prev" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 6 6 6-6 6" />}
      </svg>
    </button>
  );
}
