"use client";

import { useMemo } from "react";
import type { Trip, TripStep } from "@/lib/types/trip";
import {
  computeNightsForStep,
  effectiveStepEndParts,
  effectiveStepStartParts,
} from "@/lib/timeline/hotelsAndDates";
import { useI18n } from "@/components/providers/I18nProvider";
import { formatTripDateTimeForLocale } from "@/lib/i18n/format";

export function StepList({
  trip,
  onEdit,
  onDelete,
  onSetActive,
}: {
  trip: Trip;
  onEdit: (step: TripStep) => void;
  onDelete: (stepId: string) => void;
  onSetActive: (stepId: string) => void;
}) {
  const { t, locale } = useI18n();
  const steps = useMemo(
    () => [...trip.steps].sort((a, b) => a.order - b.order),
    [trip.steps]
  );

  return (
    <div className="space-y-3">
      {steps.map((s, idx) => {
        const start = effectiveStepStartParts(s);
        const end = effectiveStepEndParts(s);
        const nights = computeNightsForStep(s);
        return (
          <div
            key={s.id}
            className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {idx + 1}. {s.title.trim() || t("step.title")}
                </div>
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                  {start.date
                    ? formatTripDateTimeForLocale(locale, start.date, start.time)
                    : "—"}{" "}
                  →{" "}
                  {end.date ? formatTripDateTimeForLocale(locale, end.date, end.time) : "—"} ·{" "}
                  {t("step.nights")}: {nights}
                </div>
                {s.location.trim() ? (
                  <div className="mt-1 text-xs text-zinc-500">{s.location}</div>
                ) : null}
                {s.hotels.length > 0 ? (
                  <div className="mt-1">
                    <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-900 dark:bg-sky-900/40 dark:text-sky-100">
                      🏨 {s.hotels.length}
                    </span>
                  </div>
                ) : null}
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
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
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900"
                onClick={() => onSetActive(s.id)}
              >
                {t("step.setActive")}
              </button>
              <button
                type="button"
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900"
                onClick={() => onEdit(s)}
              >
                {t("common.edit")}
              </button>
              <button
                type="button"
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
                onClick={() => onDelete(s.id)}
              >
                {t("common.delete")}
              </button>
            </div>
          </div>
        );
      })}
      {!steps.length ? (
        <p className="text-sm text-zinc-500">{t("view.none")}</p>
      ) : null}
    </div>
  );
}
