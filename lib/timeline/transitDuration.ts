import type { TransitStep, TripStep } from "@/lib/types/trip";
import {
  addMinutesToTripParts,
  formatTripDateTimeSpan,
  instantFromParts,
  isValidDdMmYyyy,
  type TripDateTimeParts,
} from "@/lib/timeline/dates";

export function clampTransitDurationParts(
  days: number,
  hours: number,
  minutes: number
): { transitDurationDays: number; transitDurationHours: number; transitDurationMinutes: number } {
  return {
    transitDurationDays: Math.max(0, Math.floor(days)),
    transitDurationHours: Math.max(0, Math.min(23, Math.floor(hours))),
    transitDurationMinutes: Math.max(0, Math.min(59, Math.floor(minutes))),
  };
}

export function totalMinutesFromTransitDuration(step: TransitStep): number {
  const d = step.transitDurationDays ?? 0;
  const h = step.transitDurationHours ?? 0;
  const m = step.transitDurationMinutes ?? 0;
  const c = clampTransitDurationParts(d, h, m);
  return c.transitDurationDays * 24 * 60 + c.transitDurationHours * 60 + c.transitDurationMinutes;
}

function breakdownTotalMinutes(total: number): {
  transitDurationDays: number;
  transitDurationHours: number;
  transitDurationMinutes: number;
} {
  const t = Math.max(0, Math.floor(total));
  const transitDurationDays = Math.floor(t / (24 * 60));
  let rem = t - transitDurationDays * 24 * 60;
  const transitDurationHours = Math.floor(rem / 60);
  const transitDurationMinutes = rem % 60;
  return { transitDurationDays, transitDurationHours, transitDurationMinutes };
}

export function inferTransitDurationFromStartEnd(step: TransitStep): TransitStep {
  const start: TripDateTimeParts = {
    date: step.startDate.trim(),
    time: step.startTime.trim(),
  };
  const end: TripDateTimeParts = {
    date: step.endDate.trim(),
    time: step.endTime.trim(),
  };
  const a = instantFromParts(start);
  const b = instantFromParts(end);
  if (!a || !b || b.getTime() <= a.getTime()) return step;
  const total = Math.floor((b.getTime() - a.getTime()) / 60_000);
  return { ...step, ...breakdownTotalMinutes(total) };
}

function transitHasExplicitDurationKeys(step: TransitStep): boolean {
  const raw = step as unknown as Record<string, unknown>;
  return (
    "transitDurationDays" in raw ||
    "transitDurationHours" in raw ||
    "transitDurationMinutes" in raw
  );
}

/** Normalize duration fields when loading from Firestore or merging legacy steps. */
export function normalizeTransitStepDurationFields(step: TransitStep): TransitStep {
  let s = { ...step };
  const hasKeys = transitHasExplicitDurationKeys(s);

  if (!hasKeys) {
    s = inferTransitDurationFromStartEnd(s);
    let total = totalMinutesFromTransitDuration(s);
    if (total <= 0) {
      const c = clampTransitDurationParts(0, 1, 0);
      s = { ...s, ...c };
    } else {
      const c = clampTransitDurationParts(
        s.transitDurationDays ?? 0,
        s.transitDurationHours ?? 0,
        s.transitDurationMinutes ?? 0
      );
      s = { ...s, ...c };
    }
    return s;
  }

  const total = totalMinutesFromTransitDuration(s);
  if (total > 0) {
    const c = clampTransitDurationParts(
      s.transitDurationDays ?? 0,
      s.transitDurationHours ?? 0,
      s.transitDurationMinutes ?? 0
    );
    return { ...s, ...c };
  }

  return {
    ...s,
    ...clampTransitDurationParts(
      s.transitDurationDays ?? 0,
      s.transitDurationHours ?? 0,
      s.transitDurationMinutes ?? 0
    ),
  };
}

/** Persisted `endDate` / `endTime` for transit = start + duration (for timeline / maps). */
export function applyTransitDurationToEnd<T extends TripStep>(step: T): T {
  if (step.type !== "transit") return step;
  const tr = step as TransitStep;
  const start: TripDateTimeParts = {
    date: tr.startDate.trim(),
    time: tr.startTime.trim(),
  };
  const mins = totalMinutesFromTransitDuration(tr);
  if (!isValidDdMmYyyy(start.date) || mins <= 0) {
    return { ...tr, endDate: "", endTime: "", endDateOpen: false } as T;
  }
  const a = instantFromParts(start);
  if (!a) {
    return { ...tr, endDate: "", endTime: "", endDateOpen: false } as T;
  }
  const endParts = addMinutesToTripParts(start, mins);
  if (!endParts) {
    return { ...tr, endDate: "", endTime: "", endDateOpen: false } as T;
  }
  return {
    ...tr,
    endDate: endParts.date,
    endTime: endParts.time,
    endDateOpen: false,
  } as T;
}

export function transitStepDurationLabel(step: TripStep): string {
  if (step.type !== "transit") return "";
  const start: TripDateTimeParts = {
    date: step.startDate.trim(),
    time: step.startTime.trim(),
  };
  if (!instantFromParts(start)) return "";
  const mins = totalMinutesFromTransitDuration(step);
  if (mins <= 0) return "";
  const end = addMinutesToTripParts(start, mins);
  if (!end) return "";
  return formatTripDateTimeSpan(start, end);
}
