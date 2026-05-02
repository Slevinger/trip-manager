import type { TripStep } from "@/lib/types/trip";

function stepStartMs(step: TripStep): number {
  const t = Date.parse(step.startTime);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Chronological by step start, then legacy `order`, then id for stability. */
export function compareTripStepsByStartTime(a: TripStep, b: TripStep): number {
  const da = stepStartMs(a);
  const db = stepStartMs(b);
  if (da !== db) return da - db;
  if (a.order !== b.order) return a.order - b.order;
  return a.id.localeCompare(b.id);
}

export function sortTripStepsByStartTime(steps: readonly TripStep[]): TripStep[] {
  return [...steps].sort(compareTripStepsByStartTime);
}
