import type { Trip, TripStep } from "@/lib/types/trip";
import { sortTripStepsByStartTime } from "@/lib/tripStepSort";

const DAY_MS = 24 * 3600 * 1000;

function startMs(step: TripStep): number {
  return new Date(step.startTime).getTime();
}

function durationMs(step: TripStep): number {
  const start = startMs(step);
  const end = step.endTime ? new Date(step.endTime).getTime() : start;
  return Math.max(0, end - start);
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Returns every YYYY-MM-DD key from startKey through endKey inclusive. */
function getDaysBetween(startKey: string, endKey: string): string[] {
  const [sy, sm, sd] = startKey.split("-").map(Number);
  const [ey, em, ed] = endKey.split("-").map(Number);
  const days: string[] = [];
  let cursor = new Date(sy, (sm ?? 1) - 1, sd ?? 1, 0, 0, 0, 0);
  const endDate = new Date(ey, (em ?? 1) - 1, ed ?? 1, 0, 0, 0, 0);
  while (cursor.getTime() <= endDate.getTime()) {
    days.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`
    );
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return days;
}

/** Returns every local calendar day that a step occupies (start → end inclusive). */
function stepDayKeys(step: TripStep): string[] {
  const startKey = localDateKey(step.startTime);
  const endKey = step.endTime ? localDateKey(step.endTime) : startKey;
  return getDaysBetween(startKey, endKey);
}

export function tripDayKeys(trip: Trip): string[] {
  const set = new Set<string>();
  const start = new Date(trip.startDate);
  const end = new Date(trip.endDate);
  if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
    let cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= end.getTime()) {
      set.add(
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`
      );
      cursor = new Date(cursor.getTime() + DAY_MS);
    }
  }
  // Include every day each step spans, not just its start day
  for (const step of trip.steps) {
    for (const day of stepDayKeys(step)) set.add(day);
  }
  return Array.from(set).sort();
}

export function groupStepsByDay(trip: Trip): Map<string, TripStep[]> {
  const map = new Map<string, TripStep[]>();
  const sorted = sortTripStepsByStartTime(trip.steps);
  for (const day of tripDayKeys(trip)) map.set(day, []);
  // Place each step in every day it spans (start → end inclusive)
  for (const step of sorted) {
    for (const day of stepDayKeys(step)) {
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(step);
    }
  }
  return map;
}

interface MoveArgs {
  trip: Trip;
  stepId: string;
  /** Target day in `YYYY-MM-DD` (local). */
  targetDay: string;
  /** Index inside the target day list. -1 / out-of-range = append. */
  targetIndex: number;
}

/**
 * Move a step to a new day / position. Preserves the original time-of-day on
 * cross-day moves; otherwise repositions within the same day with sub-second
 * spacing so the existing time-sort yields the requested order.
 */
export function moveStepToDay({ trip, stepId, targetDay, targetIndex }: MoveArgs): Trip {
  const grouped = groupStepsByDay(trip);
  const fromKey = (() => {
    for (const [day, items] of grouped.entries()) {
      if (items.some((s) => s.id === stepId)) return day;
    }
    return null;
  })();
  if (!fromKey) return trip;

  const sourceList = (grouped.get(fromKey) ?? []).filter((s) => s.id !== stepId);
  grouped.set(fromKey, sourceList);

  const target = grouped.get(targetDay) ?? [];
  const moved = trip.steps.find((s) => s.id === stepId);
  if (!moved) return trip;
  const dur = durationMs(moved);

  // Compute new startTime for the moved step.
  let newStart: Date;
  if (targetDay === fromKey) {
    newStart = new Date(moved.startTime);
  } else {
    // Shift to same local time-of-day on target day.
    const orig = new Date(moved.startTime);
    const [yy, mm, dd] = targetDay.split("-").map((n) => Number.parseInt(n, 10));
    newStart = new Date(yy, (mm ?? 1) - 1, dd ?? 1, orig.getHours(), orig.getMinutes(), orig.getSeconds(), orig.getMilliseconds());
  }
  const movedStep: TripStep = {
    ...moved,
    startTime: newStart.toISOString(),
    endTime: moved.endTime ? new Date(newStart.getTime() + dur).toISOString() : undefined,
  };

  const idx = targetIndex < 0 || targetIndex > target.length ? target.length : targetIndex;
  const nextDayList = [...target.slice(0, idx), movedStep, ...target.slice(idx)];
  grouped.set(targetDay, nextDayList);

  // Re-stamp times within the target day to enforce visual order via existing
  // time-sort (`sortTripStepsByStartTime`). Earliest-start preserved + 1s offsets
  // when entries collide. This keeps the UI deterministic even for free-form
  // ordering across activities that share the same hour.
  const restampedDay = restampDay(nextDayList, targetDay);
  grouped.set(targetDay, restampedDay);

  // Same restamp for the source day to keep its order tight.
  if (fromKey !== targetDay) {
    grouped.set(fromKey, restampDay(grouped.get(fromKey) ?? [], fromKey));
  }

  const stepsById = new Map<string, TripStep>();
  for (const list of grouped.values()) for (const s of list) stepsById.set(s.id, s);

  // Steps not present in any grouped day key (shouldn't happen but be defensive)
  for (const original of trip.steps) {
    if (!stepsById.has(original.id)) stepsById.set(original.id, original);
  }

  const nextSteps: TripStep[] = Array.from(stepsById.values()).map((s, i) => ({ ...s, order: i }));
  return { ...trip, steps: nextSteps, updatedAt: new Date().toISOString() };
}

function restampDay(list: TripStep[], dayKey: string): TripStep[] {
  if (list.length <= 1) return list;
  const [yy, mm, dd] = dayKey.split("-").map((n) => Number.parseInt(n, 10));
  return list.map((step, idx) => {
    const orig = new Date(step.startTime);
    const dur = durationMs(step);
    // Preserve original hours/minutes for first item; for siblings, bump by index seconds.
    let next: Date;
    if (idx === 0) {
      next = orig;
    } else {
      next = new Date(yy, (mm ?? 1) - 1, dd ?? 1, orig.getHours(), orig.getMinutes(), orig.getSeconds() + idx, orig.getMilliseconds());
    }
    return {
      ...step,
      startTime: next.toISOString(),
      endTime: step.endTime ? new Date(next.getTime() + dur).toISOString() : undefined,
    };
  });
}
