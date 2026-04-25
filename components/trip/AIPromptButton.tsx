"use client";

import { useMemo, useState } from "react";
import type { Trip } from "@/lib/types/trip";
import { collectAllWarnings } from "@/lib/timeline/warnings";
import { computeBudgetTotals } from "@/lib/timeline/budget";
import { useI18n } from "@/components/providers/I18nProvider";
import { formatYmdForLocale } from "@/lib/i18n/format";
import type { TripCurrency } from "@/lib/i18n/currency";

function pickCurrentStep(trip: Trip) {
  const ordered = [...trip.steps].sort((a, b) => a.order - b.order);
  const active = ordered.find((s) => s.status === "active");
  return active ?? ordered[0] ?? null;
}

function buildPrompt(
  trip: Trip,
  t: (k: string) => string,
  locale: "he" | "en" | "ru",
  currency: TripCurrency
) {
  const current = pickCurrentStep(trip);
  const { time, hotel } = collectAllWarnings(trip);
  const budget = computeBudgetTotals(trip);
  const lines: string[] = [];
  lines.push(t("ai.intro"));
  lines.push("");
  lines.push(`${t("ai.tripTitle")}: ${trip.title}`);
  lines.push(
    `${t("ai.tripDates")}: ${trip.tripStart ? formatYmdForLocale(locale, trip.tripStart) : "—"}`
  );
  lines.push(
    `${t("ai.currentStep")}: ${current ? current.title || current.location || current.id : "—"}`
  );
  lines.push("");
  lines.push(`${t("ai.warnings")}:`);
  if (!time.length && !hotel.length) lines.push("—");
  for (const w of hotel) lines.push(`- [hotel] ${w.code} (${w.stepId})`);
  for (const w of time) lines.push(`- [time] ${w.code} (${w.stepId ?? ""})`);
  lines.push("");
  lines.push(`${t("ai.displayCurrency")}: ${currency}`);
  lines.push(`${t("ai.budget")}: ${JSON.stringify(budget)}`);
  lines.push("");
  lines.push(`${t("ai.jsonSteps")}:`);
  lines.push(JSON.stringify(trip.steps, null, 2));
  return lines.join("\n");
}

export function AIPromptButton({ trip }: { trip: Trip }) {
  const { t, locale, currency } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = useMemo(
    () => buildPrompt(trip, t, locale, currency),
    [trip, t, locale, currency]
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="w-full rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
    >
      {copied ? t("common.copied") : t("view.aiPrompt")}
    </button>
  );
}
