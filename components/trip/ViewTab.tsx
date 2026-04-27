"use client";

import { useMemo } from "react";
import { Timeline } from "@/components/trip/Timeline";
import { TripLeafletMap } from "@/components/trip/TripLeafletMap";
import { TimeIntelligence } from "@/components/trip/TimeIntelligence";
import { BudgetSummary } from "@/components/trip/BudgetSummary";
import { AIPromptButton } from "@/components/trip/AIPromptButton";
import { useTripDocument } from "@/components/providers/TripDocumentProvider";
import { useI18n } from "@/components/providers/I18nProvider";
import {
  computeNightsForStep,
  effectiveStepEndParts,
  effectiveStepStartParts,
} from "@/lib/timeline/hotelsAndDates";
import { formatTripDateTimeForLocale } from "@/lib/i18n/format";
import type { Trip } from "@/lib/types/trip";

function pickCurrentStep(trip: Trip) {
  const ordered = [...trip.steps].sort((a, b) => a.order - b.order);
  const active = ordered.find((s) => s.status === "active");
  return active ?? ordered[0] ?? null;
}

export function ViewTab() {
  const { trip } = useTripDocument();
  const { t, locale } = useI18n();
  const current = useMemo(() => (trip ? pickCurrentStep(trip) : null), [trip]);

  if (!trip) return null;

  const startParts = current ? effectiveStepStartParts(current) : null;
  const endParts = current ? effectiveStepEndParts(current) : null;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {t("view.currentStep")}
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          {trip.autoCurrentByDate ? t("view.autoOn") : t("view.autoOff")}
        </p>
        <p className="mt-1 text-xs text-zinc-500">{t("view.setActiveHint")}</p>
        {current ? (
          <div className="mt-3 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900/50">
            <div className="font-semibold text-zinc-900 dark:text-zinc-50">
              {current.title.trim() || t("step.title")}
            </div>
            {current.location.trim() ? (
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                {current.location}
              </div>
            ) : null}
            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
              {startParts?.date
                ? formatTripDateTimeForLocale(locale, startParts.date, startParts.time)
                : "—"}{" "}
              →{" "}
              {endParts?.date
                ? formatTripDateTimeForLocale(locale, endParts.date, endParts.time)
                : "—"}
            </div>
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              {t("step.nights")}: {computeNightsForStep(current)}
            </div>
            {current.hotels[0]?.name.trim() ? (
              <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                {t("hotels.title")}: {current.hotels[0].name.trim()}
              </div>
            ) : null}
            {current.hotels[0]?.bookingUrl.trim() ? (
              <div className="mt-1 text-xs">
                <a
                  href={current.hotels[0].bookingUrl.trim()}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  {t("hotels.bookingUrl")}
                </a>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">{t("view.none")}</p>
        )}
      </section>

      <Timeline trip={trip} />

      <TripLeafletMap trip={trip} />

      <TimeIntelligence trip={trip} />
      <BudgetSummary trip={trip} />
      <AIPromptButton trip={trip} />
    </div>
  );
}
