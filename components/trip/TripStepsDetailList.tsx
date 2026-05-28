"use client";

import { destinationFromList } from "@/lib/tripDestinationRegistry";
import { useI18n } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/messages";
import type {
  ActivityStepInterval,
  Destination,
  StayStepInterval,
  TransitStepInterval,
  TripStep,
} from "@/lib/types/trip";

export type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function stepEmoji(step: TripStep): string {
  if (step.stepType === "stay") return "🏨";
  if (step.stepType === "activity") return "📍";
  return "✈️";
}

export function kindLabel(step: TripStep, t: TFn): string {
  switch (step.stepType) {
    case "stay":
      return t("view.kindStay");
    case "transit":
      return t("view.kindTransit");
    case "activity":
      return t("view.kindActivity");
  }
}

export function formatStepRange(startIso: string, endIso: string | undefined, empty: string): string {
  const a = new Date(startIso);
  const b = endIso ? new Date(endIso) : null;
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  if (!b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return empty;
  return `${a.toLocaleString(undefined, opts)} → ${b.toLocaleString(undefined, opts)}`;
}

export function stepPlaceLine(step: TripStep, destinations: Destination[], t: TFn): string {
  const unk = t("view.placeUnknown");
  const dash = t("view.emDash");
  if (step.stepType === "stay") {
    const d = destinationFromList(destinations, step.targetDestinationId);
    return d?.title || d?.location || dash;
  }
  if (step.stepType === "transit") {
    const a = destinationFromList(destinations, step.fromStayId);
    const b = destinationFromList(destinations, step.toStayId);
    const al = a?.title || a?.location || unk;
    const bl = b?.title || b?.location || unk;
    return `${al} → ${bl}`;
  }
  const d = destinationFromList(destinations, step.destinationId);
  return d?.title || d?.location || dash;
}

export function StepIntervalsBlock({
  step,
  destinations,
  t,
}: {
  step: TripStep;
  destinations: Destination[];
  t: TFn;
}) {
  const intervals = step.stepIntervals;
  if (!intervals.length) return null;
  const dash = t("view.emDash");

  return (
    <ul className="mt-2 space-y-1.5 border-l-2 border-violet-200 pl-2.5 dark:border-violet-800/80">
      {intervals.map((int, i) => {
        if (int.intervalType === "stay") {
          const si = int as StayStepInterval;
          const loc = (si.location ?? "").trim();
          return (
            <li key={si.id} className="text-[11px] leading-snug">
              <span className="font-medium text-zinc-800 dark:text-zinc-100">
                {i + 1}. {si.title.trim() || t("view.intervalStayPeriod")}
              </span>
              <span className="mt-0.5 block font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                {formatStepRange(si.startTime, si.endTime, dash)}
              </span>
              {loc ? (
                <span className="mt-0.5 block text-zinc-600 dark:text-zinc-300">{loc}</span>
              ) : null}
              <span className="mt-0.5 block text-[10px] text-zinc-500 dark:text-zinc-500">{si.stayType}</span>
            </li>
          );
        }
        if (int.intervalType === "transit") {
          const ti = int as TransitStepInterval;
          const mode = ti.transitType.replace(/_/g, " ");
          return (
            <li key={ti.id} className="text-[11px] leading-snug">
              <span className="font-medium text-zinc-800 dark:text-zinc-100">
                {i + 1}. {ti.title.trim() || t("view.intervalLeg")}
              </span>
              <span className="mt-0.5 block font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                {formatStepRange(ti.startTime, ti.endTime, dash)}
              </span>
              <span className="mt-0.5 block text-[10px] capitalize text-zinc-500 dark:text-zinc-500">
                {mode}
              </span>
            </li>
          );
        }
        const ai = int as ActivityStepInterval;
        const d = destinationFromList(destinations, ai.destinationId);
        const place = d ? (d.title || d.location || "").trim() : "";
        return (
          <li key={ai.id} className="text-[11px] leading-snug">
            <span className="font-medium text-zinc-800 dark:text-zinc-100">
              {i + 1}. {ai.title.trim() || t("view.intervalSlot")}
            </span>
            <span className="mt-0.5 block font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
              {formatStepRange(ai.startTime, ai.endTime, dash)}
            </span>
            {place ? (
              <span className="mt-0.5 block text-zinc-600 dark:text-zinc-300">{place}</span>
            ) : null}
            <span className="mt-0.5 block text-[10px] capitalize text-zinc-500 dark:text-zinc-500">
              {ai.activityType.replace(/_/g, " ")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function TripStepsDetailList({
  steps,
  destinations,
  emphasizedStepId,
  dense = false,
}: {
  steps: TripStep[];
  destinations: Destination[];
  /** Highlights this step (e.g. current dashboard step). */
  emphasizedStepId?: string | null;
  dense?: boolean;
}) {
  const { t } = useI18n();

  if (steps.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("view.noStepsInManage")}</p>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 ${dense ? "text-[13px]" : ""}`}
    >
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {steps.map((s, idx) => {
          const emphasized = emphasizedStepId != null && s.id === emphasizedStepId;
          return (
            <li
              key={s.id}
              className={`flex gap-3 border-l-4 border-l-transparent bg-white px-3 py-2.5 dark:bg-zinc-950 ${
                emphasized ? "border-l-violet-500 bg-violet-50/90 dark:bg-violet-950/35" : ""
              } ${dense ? "py-2" : ""}`}
            >
              <span className="shrink-0 pt-0.5 text-base" aria-hidden>
                {stepEmoji(s)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[11px] font-mono text-zinc-400">{idx + 1}.</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {s.title.trim() || t("view.untitledStep")}
                  </span>
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {kindLabel(s, t)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {formatStepRange(s.startTime, s.endTime, t("view.emDash"))}
                </p>
                <p className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-300">
                  {stepPlaceLine(s, destinations, t)}
                </p>
                <StepIntervalsBlock step={s} destinations={destinations} t={t} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
