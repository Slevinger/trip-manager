import { sortTripStepsByStartTime } from "@/lib/tripStepSort";
import type { Trip, TripStep } from "@/lib/types/trip";

export function tripInstantMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Before first day / first instant of trip, during inclusive window, or after trip end. */
export type TripViewPhase = "before_start" | "during" | "after_end";

export function getTripViewPhase(trip: Trip, nowMs: number): TripViewPhase {
  const start = tripInstantMs(trip.startDate);
  const end = tripInstantMs(trip.endDate);
  if (start == null || end == null) return "before_start";
  if (nowMs < start) return "before_start";
  if (nowMs > end) return "after_end";
  return "during";
}

export type CurrentStepFocus =
  | { kind: "active"; step: TripStep }
  | { kind: "upcoming"; step: TripStep }
  | { kind: "none" };

/**
 * Pick the step to highlight on the in-trip dashboard: inside a step window,
 * otherwise the next step that has not started, otherwise the last step.
 */
export function resolveCurrentStepForDashboard(trip: Trip, nowMs: number): CurrentStepFocus {
  const sorted = sortTripStepsByStartTime(trip.steps);
  if (sorted.length === 0) return { kind: "none" };

  for (const s of sorted) {
    const st = tripInstantMs(s.startTime);
    const en = tripInstantMs(s.endTime ?? s.startTime);
    if (st == null || en == null) continue;
    if (nowMs >= st && nowMs < en) return { kind: "active", step: s };
  }

  for (const s of sorted) {
    const st = tripInstantMs(s.startTime);
    if (st != null && nowMs < st) return { kind: "upcoming", step: s };
  }

  return { kind: "active", step: sorted[sorted.length - 1] };
}

export function stepTimeWindowEndMs(step: TripStep): number | null {
  return tripInstantMs(step.endTime ?? step.startTime);
}

/** Span from trip start to end (from stored dates). */
export function tripTotalDurationMs(trip: Trip): number | null {
  const a = tripInstantMs(trip.startDate);
  const b = tripInstantMs(trip.endDate);
  if (a == null || b == null || b <= a) return null;
  return b - a;
}

/** Milliseconds from `nowMs` until `trip.startDate` (may be negative if already started). */
export function msUntilTripStart(trip: Trip, nowMs: number): number | null {
  const a = tripInstantMs(trip.startDate);
  if (a == null) return null;
  return a - nowMs;
}

/** Milliseconds from `nowMs` until `trip.endDate` (may be negative if already ended). */
export function msUntilTripEnd(trip: Trip, nowMs: number): number | null {
  const b = tripInstantMs(trip.endDate);
  if (b == null) return null;
  return b - nowMs;
}

/** Readable duration for countdowns and totals (non-negative input). */
export function formatDurationMs(deltaMs: number): string {
  if (deltaMs <= 0) return "Less than a minute";
  let sec = Math.floor(deltaMs / 1000);
  const days = Math.floor(sec / 86400);
  sec %= 86400;
  const hours = Math.floor(sec / 3600);
  sec %= 3600;
  const minutes = Math.floor(sec / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  return parts.join(", ");
}
