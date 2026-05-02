"use client";

import { destinationFromList } from "@/lib/tripDestinationRegistry";
import type {
  ActivityStepInterval,
  Destination,
  StayStepInterval,
  TransitStepInterval,
  TripStep,
} from "@/lib/types/trip";

function stepEmoji(step: TripStep): string {
  if (step.stepType === "stay") return "🏨";
  if (step.stepType === "activity") return "📍";
  return "✈️";
}

function kindLabel(step: TripStep): string {
  switch (step.stepType) {
    case "stay":
      return "Stay";
    case "transit":
      return "Transit";
    case "activity":
      return "Activity";
  }
}

function formatStepRange(startIso: string, endIso: string | undefined): string {
  const a = new Date(startIso);
  const b = endIso ? new Date(endIso) : null;
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  if (!b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "—";
  return `${a.toLocaleString(undefined, opts)} → ${b.toLocaleString(undefined, opts)}`;
}

function stepPlaceLine(step: TripStep, destinations: Destination[]): string {
  if (step.stepType === "stay") {
    const d = destinationFromList(destinations, step.targetDestinationId);
    return d?.title || d?.location || "—";
  }
  if (step.stepType === "transit") {
    const a = destinationFromList(destinations, step.fromStayId);
    const b = destinationFromList(destinations, step.toStayId);
    const al = a?.title || a?.location || "?";
    const bl = b?.title || b?.location || "?";
    return `${al} → ${bl}`;
  }
  const d = destinationFromList(destinations, step.destinationId);
  return d?.title || d?.location || "—";
}

function StepIntervalsBlock({ step, destinations }: { step: TripStep; destinations: Destination[] }) {
  const intervals = step.stepIntervals;
  if (!intervals.length) return null;

  return (
    <ul className="mt-2 space-y-1.5 border-l-2 border-violet-200 pl-2.5 dark:border-violet-800/80">
      {intervals.map((int, i) => {
        if (int.intervalType === "stay") {
          const si = int as StayStepInterval;
          const loc = (si.location ?? "").trim();
          return (
            <li key={si.id} className="text-[11px] leading-snug">
              <span className="font-medium text-zinc-800 dark:text-zinc-100">
                {i + 1}. {si.title.trim() || "Stay period"}
              </span>
              <span className="mt-0.5 block font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                {formatStepRange(si.startTime, si.endTime)}
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
                {i + 1}. {ti.title.trim() || "Leg"}
              </span>
              <span className="mt-0.5 block font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                {formatStepRange(ti.startTime, ti.endTime)}
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
              {i + 1}. {ai.title.trim() || "Slot"}
            </span>
            <span className="mt-0.5 block font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
              {formatStepRange(ai.startTime, ai.endTime)}
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
  if (steps.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">No steps yet — add them in Manage.</p>
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
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
                  <span className="text-[11px] font-mono text-zinc-400">{idx + 1}.</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {s.title.trim() || "Untitled step"}
                  </span>
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {kindLabel(s)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {formatStepRange(s.startTime, s.endTime)}
                </p>
                <p className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-300">
                  {stepPlaceLine(s, destinations)}
                </p>
                <StepIntervalsBlock step={s} destinations={destinations} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
