"use client";

import { useState } from "react";
import type { Trip, TripStep } from "@/lib/types/trip";
import { collectAllWarnings } from "@/lib/timeline/warnings";
import { computeBudgetTotals } from "@/lib/timeline/budget";
import { useI18n } from "@/components/providers/I18nProvider";
import {
  formatDateForLocale,
  formatTripDateTimeForLocale,
  localCalendarYmd,
} from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import type { TripCurrency } from "@/lib/i18n/currency";

const PRESET_IDS = ["help", "budget", "schedule"] as const;
type PresetId = (typeof PRESET_IDS)[number];
type QuestionMode = PresetId | "custom";

function presetLabelKey(id: PresetId): string {
  return `ai.preset${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

function askTextKey(id: PresetId): string {
  return `ai.ask${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

function pickCurrentStep(trip: Trip): TripStep | null {
  const ordered = [...trip.steps].sort((a, b) => a.order - b.order);
  const active = ordered.find((s) => s.status === "active");
  return active ?? ordered[0] ?? null;
}

function stepLabel(step: TripStep): string {
  const parts = [step.title, step.location].filter(Boolean);
  return parts.length ? parts.join(" · ") : step.id;
}

function resolveQuestionText(
  mode: QuestionMode,
  customDraft: string,
  t: (k: string) => string
): string | null {
  if (mode === "custom") {
    const s = customDraft.trim();
    return s.length ? s : null;
  }
  return t(askTextKey(mode));
}

function buildPrompt(
  trip: Trip,
  generatedAt: Date,
  t: (k: string) => string,
  locale: Locale,
  currency: TripCurrency,
  formatMoney: (n: number) => string,
  questionAppend: string | null
): string {
  const current = pickCurrentStep(trip);
  const { time, hotel } = collectAllWarnings(trip);
  const budget = computeBudgetTotals(trip);
  const planned = trip.budget > 0 ? trip.budget : 0;
  const difference = planned > 0 ? planned - budget.total : 0;

  const stepById = new Map(trip.steps.map((s) => [s.id, s] as const));

  const lines: string[] = [];

  lines.push(`— ${t("ai.snapshotTitle")} —`);
  lines.push(t("ai.intro"));
  lines.push("");
  lines.push(
    `${t("ai.generatedAt")}: ${formatDateForLocale(locale, generatedAt, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`
  );
  lines.push(`${t("ai.generatedAtUtc")}: ${generatedAt.toISOString()}`);
  const todayYmd = localCalendarYmd(generatedAt);
  const todayM = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayYmd);
  const todayDt = todayM
    ? new Date(Number(todayM[1]), Number(todayM[2]) - 1, Number(todayM[3]))
    : generatedAt;
  lines.push(
    `${t("ai.calendarToday")}: ${formatDateForLocale(locale, todayDt)} (${todayYmd})`
  );
  lines.push("");
  lines.push(t("ai.hintRelativeDates"));
  lines.push("");

  lines.push(`— ${t("ai.tripOverviewTitle")} —`);
  lines.push(`${t("ai.tripTitle")}: ${trip.title}`);
  lines.push(
    `${t("ai.tripDates")}: ${
      trip.tripStartDate
        ? formatTripDateTimeForLocale(locale, trip.tripStartDate, trip.tripStartTime)
        : "—"
    }`
  );
  lines.push(
    `${t("ai.tripBudget")}: ${trip.budget > 0 ? formatMoney(trip.budget) : "—"}`
  );
  lines.push(`${t("ai.displayCurrency")}: ${currency}`);
  lines.push("");
  lines.push(`${t("ai.tripFlags")}:`);
  lines.push(
    `- ${t("manage.smartTimeline")}: ${trip.smartTimeline ? t("ai.flagYes") : t("ai.flagNo")}`
  );
  lines.push(
    `- ${t("manage.autoCurrent")}: ${trip.autoCurrentByDate ? t("ai.flagYes") : t("ai.flagNo")}`
  );
  lines.push("");

  lines.push(`— ${t("ai.currentStep")} —`);
  if (!current) {
    lines.push(t("ai.stepNone"));
  } else {
    lines.push(`id: ${current.id}`);
    lines.push(`${t("step.title")}: ${current.title || "—"}`);
    lines.push(`${t("step.location")}: ${current.location || "—"}`);
    lines.push(`${t("step.status")}: ${t(`status.${current.status}`)}`);
    const startDisp = current.startDate
      ? formatTripDateTimeForLocale(locale, current.startDate, current.startTime)
      : "—";
    let endDisp: string;
    if (current.endDateOpen) {
      endDisp = t("manage.endDateOpen");
    } else if (current.endDate) {
      endDisp = formatTripDateTimeForLocale(locale, current.endDate, current.endTime);
    } else {
      endDisp = "—";
    }
    lines.push(`${t("step.startDate")}: ${startDisp}`);
    lines.push(`${t("step.endDate")}: ${endDisp}`);
    if (current.type !== "transit") {
      lines.push(
        `${t("step.nights")}: ${Number.isFinite(current.nights) ? String(current.nights) : "—"}`
      );
    }
  }
  lines.push("");

  lines.push(`— ${t("ai.warnings")} —`);
  if (!time.length && !hotel.length) {
    lines.push(t("ai.warningsNone"));
  } else {
    for (const w of hotel) {
      const sid = w.stepId;
      const hint = sid ? stepById.get(sid) : undefined;
      const stepHint = hint ? ` — ${stepLabel(hint)}` : sid ? ` — stepId=${sid}` : "";
      lines.push(`- [hotel] ${t(`warnings.hotel.${w.code}`)}${stepHint}`);
    }
    for (const w of time) {
      const sid = w.stepId;
      const hint = sid ? stepById.get(sid) : undefined;
      const stepHint = hint ? ` — ${stepLabel(hint)}` : sid ? ` — stepId=${sid}` : "";
      const meta =
        w.meta && Object.keys(w.meta).length > 0
          ? ` (${JSON.stringify(w.meta)})`
          : "";
      lines.push(`- [time] ${t(`warnings.time.${w.code}`)}${stepHint}${meta}`);
    }
  }
  lines.push("");

  lines.push(`— ${t("ai.budgetBreakdownTitle")} —`);
  const rows = [
    "transport",
    "food",
    "activities",
    "other",
    "hotels",
  ] as const;
  for (const key of rows) {
    lines.push(`${t(`budget.${key}`)}: ${formatMoney(budget[key])}`);
  }
  lines.push(`${t("budget.total")}: ${formatMoney(budget.total)}`);
  if (planned > 0) {
    lines.push(`${t("budget.planned")}: ${formatMoney(planned)}`);
    lines.push(`${t("budget.difference")}: ${formatMoney(difference)}`);
  }
  lines.push("");
  lines.push(`${t("ai.budget")} (JSON): ${JSON.stringify(budget)}`);
  lines.push("");

  lines.push(`— ${t("ai.jsonSteps")} —`);
  lines.push(JSON.stringify(trip.steps, null, 2));

  let out = lines.join("\n");
  if (questionAppend?.trim()) {
    out += `\n\n— ${t("ai.userQuestion")} —\n${questionAppend.trim()}`;
  }
  return out;
}

export function AIPromptButton({ trip }: { trip: Trip }) {
  const { t, locale, currency, formatMoney, dir } = useI18n();
  const [copied, setCopied] = useState(false);
  const [questionMode, setQuestionMode] = useState<QuestionMode>("help");
  const [customQuestion, setCustomQuestion] = useState("");

  async function copy() {
    const q = resolveQuestionText(questionMode, customQuestion, t);
    const text = buildPrompt(
      trip,
      new Date(),
      t,
      locale,
      currency,
      formatMoney,
      q
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {t("ai.builderTitle")}
      </h2>
      <label className="mt-3 block text-xs text-zinc-600 dark:text-zinc-300">
        <span>{t("ai.questionPreset")}</span>
        <select
          className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          value={questionMode}
          onChange={(e) => {
            const v = e.target.value;
            setQuestionMode(
              v === "custom" ? "custom" : (v as PresetId)
            );
          }}
        >
          {PRESET_IDS.map((id) => (
            <option key={id} value={id}>
              {t(presetLabelKey(id))}
            </option>
          ))}
          <option value="custom">{t("ai.presetCustom")}</option>
        </select>
      </label>
      {questionMode === "custom" ? (
        <textarea
          aria-label={t("ai.presetCustom")}
          dir={dir}
          className="mt-3 min-h-[88px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          value={customQuestion}
          placeholder={t("ai.customPlaceholder")}
          onChange={(e) => setCustomQuestion(e.target.value)}
        />
      ) : null}
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-4 w-full rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
      >
        {copied ? t("common.copied") : t("view.aiPrompt")}
      </button>
    </section>
  );
}
