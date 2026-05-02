"use client";

import { useI18n } from "@/lib/i18n/context";

export function TripMapLoadingPlaceholder() {
  const { t } = useI18n();
  return (
    <section className="mt-8 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-12 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
      {t("trip.mapLoading")}
    </section>
  );
}
