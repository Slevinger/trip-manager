import type { Trip, TripStep } from "@/lib/types/trip";
import { effectiveStepEnd, effectiveStepStart } from "@/lib/timeline/hotelsAndDates";
import { parseYmd } from "@/lib/timeline/dates";

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

  const tripStart = trip.tripStart.trim();
  const tripStartDate = tripStart ? parseYmd(tripStart) : null;
  const today = dayStart(now);

  if (tripStartDate && today < tripStartDate) {
    return steps[0]?.id ?? null;
  }

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const startStr = effectiveStepStart(s);
    const endStr = effectiveStepEnd(s);
    const sd = startStr ? parseYmd(startStr) : null;
    const ed = endStr ? parseYmd(endStr) : null;
    if (sd && ed) {
      if (today >= sd && today <= ed) return s.id;
    } else if (sd && !ed) {
      if (today >= sd) {
        const next = steps[i + 1];
        const ns = next ? parseYmd(effectiveStepStart(next)) : null;
        if (!ns || today < ns) return s.id;
      }
    }
  }

  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i];
    const b = steps[i + 1];
    const aEnd = effectiveStepEnd(a);
    const bStart = effectiveStepStart(b);
    const da = aEnd ? parseYmd(aEnd) : null;
    const db = bStart ? parseYmd(bStart) : null;
    if (da && db && today > da && today < db) {
      return b.id;
    }
  }

  const last = steps[steps.length - 1];
  const lastEnd = effectiveStepEnd(last);
  const lastEndD = lastEnd ? parseYmd(lastEnd) : null;
  if (lastEndD && today > lastEndD) {
    return last.id;
  }

  return steps[0]?.id ?? null;
}
