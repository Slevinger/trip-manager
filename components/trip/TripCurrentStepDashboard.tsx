"use client";

import { useMemo } from "react";
import { TripStepsDetailList } from "@/components/trip/TripStepsDetailList";
import { useI18n } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/messages";
import type { CurrentStepFocus } from "@/lib/tripViewPhase";
import {
  formatDurationMs,
  msUntilTripEnd,
  stepTimeWindowEndMs,
} from "@/lib/tripViewPhase";
import { destinationFromList } from "@/lib/tripDestinationRegistry";
import { sortTripStepsByStartTime } from "@/lib/tripStepSort";
import type { ActivityStep, StayStep, TransitStep, Trip, TripStep } from "@/lib/types/trip";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

function stepEmoji(step: TripStep): string {
  if (step.stepType === "stay") return "🏨";
  if (step.stepType === "activity") return "📍";
  return "✈️";
}

function kindLabel(step: TripStep, t: TFn): string {
  switch (step.stepType) {
    case "stay":
      return t("view.kindStay");
    case "transit":
      return t("view.kindTransit");
    case "activity":
      return t("view.kindActivity");
  }
}

function formatRange(startIso: string, endIso: string | undefined, empty: string): string {
  const a = new Date(startIso);
  const b = endIso ? new Date(endIso) : null;
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  if (!b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return empty;
  return `${a.toLocaleString(undefined, opts)} → ${b.toLocaleString(undefined, opts)}`;
}

function StayIntervalsCompact({
  step,
  destinations,
  t,
}: {
  step: StayStep;
  destinations: Trip["destinations"];
  t: TFn;
}) {
  if (step.stepIntervals.length <= 1) return null;
  return (
    <div className="mt-4 border-t border-white/20 pt-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">
        {t("view.staysOnThisStep", { count: step.stepIntervals.length })}
      </p>
      <ul className="mt-2 space-y-1.5 text-sm text-white/90">
        {step.stepIntervals.map((int, i) => {
          const slot =
            int.intervalType === "stay" && int.destinationId
              ? destinationFromList(destinations, int.destinationId)
              : undefined;
          const locLine = (int.location ?? slot?.location ?? "").trim();
          return (
            <li key={int.id} className="flex flex-wrap gap-x-2 gap-y-0.5">
              <span className="font-medium text-white">
                {i + 1}. {int.title.trim() || t("common.untitled")}
              </span>
              <span className="text-white/75">
                {formatRange(int.startTime, int.endTime, t("view.emDash"))}
              </span>
              {locLine ? (
                <span className="w-full text-xs text-white/65">{locLine}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StepBody({
  step,
  destinations,
  t,
}: {
  step: TripStep;
  destinations: Trip["destinations"];
  t: TFn;
}) {
  if (step.stepType === "stay") {
    const s = step as StayStep;
    const td = destinationFromList(destinations, s.targetDestinationId);
    return (
      <>
        <p className="mt-1 text-lg font-semibold text-white">{td?.title || t("view.defaultStayTitle")}</p>
        {(td?.location ?? "").trim() ? (
          <p className="mt-1 text-sm text-white/80">{td?.location}</p>
        ) : null}
        <StayIntervalsCompact step={s} destinations={destinations} t={t} />
      </>
    );
  }
  if (step.stepType === "transit") {
    const s = step as TransitStep;
    const from = destinationFromList(destinations, s.fromStayId);
    const to = destinationFromList(destinations, s.toStayId);
    const dash = t("view.emDash");
    return (
      <div className="mt-2 grid gap-2 text-sm text-white/90 sm:grid-cols-2">
        <div className="rounded-xl bg-white/10 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-white/60">{t("view.from")}</p>
          <p className="mt-0.5 font-medium text-white">
            {from?.title || from?.location || dash}
          </p>
          {(from?.location ?? "").trim() ? (
            <p className="text-xs text-white/70">{from?.location}</p>
          ) : null}
        </div>
        <div className="rounded-xl bg-white/10 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-white/60">{t("view.to")}</p>
          <p className="mt-0.5 font-medium text-white">
            {to?.title || to?.location || dash}
          </p>
          {(to?.location ?? "").trim() ? (
            <p className="text-xs text-white/70">{to?.location}</p>
          ) : null}
        </div>
      </div>
    );
  }
  const s = step as ActivityStep;
  const d = destinationFromList(destinations, s.destinationId);
  return (
    <>
      <p className="mt-1 text-lg font-semibold text-white">{d?.title || t("view.defaultActivityTitle")}</p>
      {(d?.location ?? "").trim() ? (
        <p className="mt-1 text-sm text-white/80">{d?.location}</p>
      ) : null}
    </>
  );
}

export function TripCurrentStepDashboard({
  trip,
  focus,
  nowMs,
}: {
  trip: Trip;
  focus: CurrentStepFocus;
  nowMs: number;
}) {
  const { t } = useI18n();
  const sortedSteps = useMemo(() => sortTripStepsByStartTime(trip.steps), [trip.steps]);

  if (focus.kind === "none") {
    return (
      <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("view.noStepsYet")}</p>
      </div>
    );
  }

  const { step } = focus;
  const isUpcoming = focus.kind === "upcoming";
  const endMs = stepTimeWindowEndMs(step);
  const pastLastStep =
    endMs != null &&
    nowMs >= endMs &&
    focus.kind === "active" &&
    step.id === sortedSteps.at(-1)?.id;

  const headerTint =
    step.stepType === "stay"
      ? "from-violet-600 to-violet-900"
      : step.stepType === "transit"
        ? "from-sky-600 to-sky-900"
        : "from-emerald-600 to-emerald-900";

  const untilTripEnd = msUntilTripEnd(trip, nowMs);

  return (
    <div className="mt-8">
      {untilTripEnd != null && untilTripEnd >= 0 ? (
        <div className="mb-4 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            {t("view.timeLeftInTrip")}
          </p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
            {formatDurationMs(untilTripEnd, t)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">{t("view.untilTripEnd")}</p>
        </div>
      ) : null}
      <div
        className={`overflow-hidden rounded-2xl bg-gradient-to-br shadow-lg ring-1 ring-black/5 dark:ring-white/10 ${headerTint}`}
      >
        <div className="px-5 pb-6 pt-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
              <span aria-hidden>{stepEmoji(step)}</span>
              {kindLabel(step, t)}
            </span>
            {isUpcoming ? (
              <span className="rounded-full bg-amber-400/90 px-2.5 py-1 text-[11px] font-bold text-amber-950">
                {t("view.upNext")}
              </span>
            ) : pastLastStep ? (
              <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white">
                {t("view.lastScheduledStep")}
              </span>
            ) : (
              <span className="rounded-full bg-emerald-400/90 px-2.5 py-1 text-[11px] font-bold text-emerald-950">
                {t("view.nowLabel")}
              </span>
            )}
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-white">
            {step.title.trim() || t("view.untitledStep")}
          </h2>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white/85">
            <span className="rounded-lg bg-black/15 px-2 py-0.5 font-mono text-xs">
              {formatRange(step.startTime, step.endTime, t("view.emDash"))}
            </span>
          </p>
          <StepBody step={step} destinations={trip.destinations} t={t} />
          {step.notes && step.notes.length > 0 ? (
            <div className="mt-4 border-t border-white/20 pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/60">{t("view.notes")}</p>
              <ul className="mt-1 list-inside list-disc text-sm text-white/85">
                {step.notes.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {sortedSteps.length > 0 ? (
        <section className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t("view.fullItinerary")}
          </h3>
          <TripStepsDetailList
            steps={sortedSteps}
            destinations={trip.destinations}
            emphasizedStepId={step.id}
          />
        </section>
      ) : null}

      <p className="mt-3 text-center text-xs text-zinc-500 dark:text-zinc-400">{t("view.switchToManageHint")}</p>
    </div>
  );
}
