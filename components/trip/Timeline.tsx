"use client";

import { useMemo } from "react";
import type { Trip } from "@/lib/types/trip";
import {
  computeNightsForStep,
  effectiveStepEndParts,
  effectiveStepStartParts,
} from "@/lib/timeline/hotelsAndDates";
import { instantFromParts } from "@/lib/timeline/dates";
import { useI18n } from "@/components/providers/I18nProvider";
import { formatTripDateTimeForLocale } from "@/lib/i18n/format";

export function Timeline({
  trip,
  onStepClick,
}: {
  trip: Trip;
  onStepClick?: (stepId: string) => void;
}) {
  const { t, locale } = useI18n();
  const steps = useMemo(() => {
    const list = [...trip.steps];
    if (trip.smartTimeline) {
      return list.sort((a, b) => {
        const as =
          instantFromParts(effectiveStepStartParts(a))?.getTime() ??
          Number.MAX_SAFE_INTEGER;
        const bs =
          instantFromParts(effectiveStepStartParts(b))?.getTime() ??
          Number.MAX_SAFE_INTEGER;
        if (as !== bs) return as - bs;
        return a.order - b.order;
      });
    }
    return list.sort((a, b) => a.order - b.order);
  }, [trip.smartTimeline, trip.steps]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {t("view.timeline")}
      </h2>
      <ol className="mt-4 space-y-3">
        {steps.map((s, idx) => {
          const start = effectiveStepStartParts(s);
          const end = effectiveStepEndParts(s);
          return (
            <li
              key={s.id}
              className={`rounded-xl border border-zinc-100 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/40 ${
                onStepClick ? "cursor-pointer transition hover:border-blue-300 dark:hover:border-blue-700" : ""
              }`}
              onClick={() => onStepClick?.(s.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-zinc-900 dark:text-zinc-50">
                    {idx + 1}. {s.title.trim() || t("step.title")}
                  </div>
                  {s.location.trim() ? (
                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                      {s.location}
                    </div>
                  ) : null}
                  {s.type === "stay" && s.hotels.length > 0 ? (
                    <div className="mt-1">
                      <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-900 dark:bg-sky-900/40 dark:text-sky-100">
                        🏨 {s.hotels.length}
                      </span>
                    </div>
                  ) : null}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    s.status === "active"
                      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                      : s.status === "done"
                        ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                        : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                  }`}
                >
                  {t(`status.${s.status}`)}
                </span>
              </div>
              <div className="mt-2 grid gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                <div>
                  {start.date
                    ? formatTripDateTimeForLocale(locale, start.date, start.time)
                    : "—"}{" "}
                  →{" "}
                  {end.date ? formatTripDateTimeForLocale(locale, end.date, end.time) : "—"}
                </div>
                {s.type !== "transit" ? (
                  <div>
                    {t("step.nights")}: {computeNightsForStep(s)}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {!steps.length ? (
        <p className="mt-3 text-sm text-zinc-500">{t("view.none")}</p>
      ) : null}
    </section>
  );
}
