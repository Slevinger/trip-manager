import type { Trip, TripStep } from "@/lib/types/trip";
import {
  effectiveStepEndParts,
  effectiveStepStartParts,
} from "@/lib/timeline/hotelsAndDates";
import {
  hasTripTime,
  instantFromParts,
  parseDdMmYyyyCalendarDate,
} from "@/lib/timeline/dates";

function orderedSteps(steps: TripStep[]): TripStep[] {
  return [...steps].sort((a, b) => a.order - b.order);
}

function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Resolve which step should be active when auto mode is on. */
export function resolveAutoActiveStepId(trip: Trip, now: Date): string | null {
  const steps = orderedSteps(trip.steps);
  if (!steps.length) return null;

  const tripStartParts = {
    date: trip.tripStartDate.trim(),
    time: trip.tripStartTime.trim(),
  };
  const tripStartInstant = tripStartParts.date ? instantFromParts(tripStartParts) : null;
  const today = dayStart(now);

  if (tripStartInstant) {
    if (hasTripTime(tripStartParts.time)) {
      if (now.getTime() < tripStartInstant.getTime()) {
        return steps[0]?.id ?? null;
      }
    } else if (today < tripStartInstant) {
      return steps[0]?.id ?? null;
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const start = effectiveStepStartParts(s);
    const end = effectiveStepEndParts(s);
    const sd = start.date ? parseDdMmYyyyCalendarDate(start.date) : null;
    const ed = end.date ? parseDdMmYyyyCalendarDate(end.date) : null;
    const sdI = start.date ? instantFromParts(start) : null;
    const edI = end.date ? instantFromParts(end) : null;
    const rangeUsesTime = hasTripTime(start.time) || hasTripTime(end.time);
    if (sdI && edI && sd && ed) {
      if (rangeUsesTime) {
        if (now.getTime() >= sdI.getTime() && now.getTime() <= edI.getTime()) return s.id;
      } else if (today >= sd && today <= ed) {
        return s.id;
      }
    } else if (sdI && !edI) {
      if (rangeUsesTime && hasTripTime(start.time)) {
        if (now.getTime() >= sdI.getTime()) {
          const next = steps[i + 1];
          const ns = next ? instantFromParts(effectiveStepStartParts(next)) : null;
          if (!ns || now.getTime() < ns.getTime()) return s.id;
        }
      } else if (sd && today >= sd) {
        const next = steps[i + 1];
        const nsD = next ? parseDdMmYyyyCalendarDate(effectiveStepStartParts(next).date) : null;
        if (!nsD || today < nsD) return s.id;
      }
    }
  }

  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i];
    const b = steps[i + 1];
    const aEnd = effectiveStepEndParts(a);
    const bStart = effectiveStepStartParts(b);
    const gapUsesTime = hasTripTime(aEnd.time) || hasTripTime(bStart.time);
    const da = aEnd.date ? parseDdMmYyyyCalendarDate(aEnd.date) : null;
    const db = bStart.date ? parseDdMmYyyyCalendarDate(bStart.date) : null;
    const daI = aEnd.date ? instantFromParts(aEnd) : null;
    const dbI = bStart.date ? instantFromParts(bStart) : null;
    if (gapUsesTime && daI && dbI) {
      if (now.getTime() > daI.getTime() && now.getTime() < dbI.getTime()) {
        return b.id;
      }
    } else if (da && db && today > da && today < db) {
      return b.id;
    }
  }

  const last = steps[steps.length - 1];
  const lastEnd = effectiveStepEndParts(last);
  const lastEndD = lastEnd.date ? parseDdMmYyyyCalendarDate(lastEnd.date) : null;
  const lastEndI = lastEnd.date ? instantFromParts(lastEnd) : null;
  if (lastEnd.date && lastEndI && hasTripTime(lastEnd.time)) {
    if (now.getTime() > lastEndI.getTime()) {
      return last.id;
    }
  } else if (lastEndD && today > lastEndD) {
    return last.id;
  }

  return steps[0]?.id ?? null;
}
