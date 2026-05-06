"use client";

import { useI18n } from "@/lib/i18n/context";
import { TripStepsCarousel } from "@/components/trip/TripStepsCarousel";
import {
  formatDurationMs,
  msUntilTripStart,
  tripTotalDurationMs,
} from "@/lib/tripViewPhase";
import type { Trip, TripStep } from "@/lib/types/trip";

function formatTripDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function openTasksCount(trip: Trip): number {
  return (trip.tasks ?? []).filter((x) => x.status !== "done" && x.status !== "cancelled").length;
}

export function TripViewSummary({
  trip,
  sortedSteps,
  nowMs,
  variant = "default",
}: {
  trip: Trip;
  sortedSteps: TripStep[];
  /** Wall clock for countdowns; refresh periodically from the parent. */
  nowMs: number;
  variant?: "default" | "ended";
}) {
  const { t } = useI18n();
  const tasks = trip.tasks ?? [];
  const docs = trip.documents ?? [];
  const budget = trip.budget?.totalBudget;
  const totalMs = tripTotalDurationMs(trip);
  const untilStart = msUntilTripStart(trip, nowMs);

  return (
    <div className="mt-8 space-y-6">
      {variant === "ended" ? (
        <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200">
          {t("view.summaryEnded")}
        </p>
      ) : (
        <p className="rounded-xl border border-violet-200 bg-violet-50/80 px-3 py-2 text-sm text-violet-950 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
          {t("view.summaryUpcoming")}
        </p>
      )}

      {variant === "default" && untilStart != null && untilStart > 0 ? (
        <div
          className={`grid gap-3 ${totalMs != null ? "sm:grid-cols-2" : ""}`}
        >
          <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4 shadow-sm dark:border-violet-800 dark:from-violet-950/50 dark:to-zinc-950">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("view.timeUntilTripStarts")}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-violet-950 dark:text-violet-50">
              {formatDurationMs(untilStart, t)}
            </p>
          </div>
          {totalMs != null ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                {t("view.totalTripTime")}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                {formatDurationMs(totalMs, t)}
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">{t("view.fromStartToEndDate")}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {variant === "ended" && totalMs != null ? (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            {t("view.scheduledTripLength")}
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
            {formatDurationMs(totalMs, t)}
          </p>
        </div>
      ) : null}

      {trip.description ? (
        <p className="line-clamp-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {trip.description}
        </p>
      ) : null}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t("view.itinerary")}</h3>
        <TripStepsCarousel steps={sortedSteps} destinations={trip.destinations} />
      </section>

      <dl className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-4 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("view.starts")}</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-100">{formatTripDate(trip.startDate)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("view.ends")}</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-100">{formatTripDate(trip.endDate)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("view.travelers")}</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-100">
            {trip.travelers.length ? trip.travelers.map((tr) => tr.name).join(", ") : t("view.emDash")}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("view.viewers")}</dt>
          <dd className="mt-0.5 text-zinc-600 dark:text-zinc-300">
            {(trip.viewers ?? []).length
              ? (trip.viewers ?? []).map((v) => v.name).join(", ")
              : t("view.emDash")}
          </dd>
          <dd className="mt-0.5 text-[10px] text-zinc-500">{t("view.viewersReadOnly")}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("view.currency")}</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-100">{trip.currency}</dd>
        </div>
        {budget ? (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("view.budget")}</dt>
            <dd className="mt-0.5 text-zinc-900 dark:text-zinc-100">
              {budget.amount.toLocaleString()} {budget.currency}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">{t("view.tasksAndDocuments")}</p>
        <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          <li>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">{tasks.length}</span>{" "}
            {tasks.length === 1 ? t("view.taskSingular") : t("view.taskPlural")}
            {tasks.length > 0 ? (
              <span className="text-zinc-500"> {t("view.openTasks", { count: openTasksCount(trip) })}</span>
            ) : null}
          </li>
          <li>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">{docs.length}</span>{" "}
            {docs.length === 1 ? t("view.documentSingular") : t("view.documentPlural")}
          </li>
        </ul>
      </div>
    </div>
  );
}
