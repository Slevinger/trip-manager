"use client";

import { useMemo } from "react";
import type { Trip } from "@/lib/types/trip";
import { computeBudgetTotals } from "@/lib/timeline/budget";
import { useI18n } from "@/components/providers/I18nProvider";

export function BudgetSummary({ trip }: { trip: Trip }) {
  const { t, formatMoney } = useI18n();
  const totals = useMemo(() => computeBudgetTotals(trip), [trip]);

  const fmt = (n: number) => formatMoney(n);

  const rows = [
    { key: "transport", value: totals.transport },
    { key: "food", value: totals.food },
    { key: "activities", value: totals.activities },
    { key: "other", value: totals.other },
    { key: "hotels", value: totals.hotels },
  ] as const;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {t("budget.title")}
      </h2>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-3">
            <dt className="text-zinc-600 dark:text-zinc-300">
              {t(`budget.${r.key}`)}
            </dt>
            <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
              {fmt(r.value)}
            </dd>
          </div>
        ))}
        <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-3 text-sm font-semibold dark:border-zinc-800">
          <span>{t("budget.total")}</span>
          <span className="tabular-nums">{fmt(totals.total)}</span>
        </div>
      </dl>
    </section>
  );
}
