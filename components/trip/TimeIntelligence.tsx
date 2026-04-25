"use client";

import { useMemo } from "react";
import type { Trip } from "@/lib/types/trip";
import { collectAllWarnings } from "@/lib/timeline/warnings";
import { useI18n } from "@/components/providers/I18nProvider";

export function TimeIntelligence({ trip }: { trip: Trip }) {
  const { t } = useI18n();
  const { time, hotel } = useMemo(() => collectAllWarnings(trip), [trip]);

  if (!time.length && !hotel.length) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {t("view.timeIntel")}
        </h2>
        <p className="mt-2 text-sm text-zinc-500">{t("view.timeClear")}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {t("view.timeIntel")}
      </h2>
      <ul className="mt-3 space-y-2 text-sm text-amber-900 dark:text-amber-100">
        {hotel.map((w, i) => (
          <li
            key={`h-${w.stepId}-${w.hotelId ?? "x"}-${w.code}-${i}`}
            className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/30"
          >
            {t(`warnings.hotel.${w.code}`)}
          </li>
        ))}
        {time.map((w, i) => (
          <li
            key={`t-${w.stepId ?? "x"}-${w.code}-${i}`}
            className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/30"
          >
            {t(`warnings.time.${w.code}`)}
            {typeof w.meta?.hours === "number"
              ? ` (${w.meta.hours}h)`
              : null}
            {typeof w.meta?.days === "number"
              ? ` (${w.meta.days})`
              : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
