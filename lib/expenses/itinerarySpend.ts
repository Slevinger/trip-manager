import type { Money, Trip, TransitStep } from "@/lib/types/trip";
import {
  activityStepTotalCost,
  stayLinkedActivitiesCost,
  stayStepLodgingCost,
  stayStepTotalCost,
  transitStepTotalCost,
} from "@/lib/trip/stepCosts";
import type { DailySpend } from "@/lib/expenses/settlement";

function tripTargetCurrency(trip: Trip): string {
  return trip.currency?.trim() || "USD";
}

function amountInTripCurrency(m: Money | null | undefined, cur: string): number {
  if (!m || m.currency !== cur || !Number.isFinite(m.amount)) return 0;
  return m.amount;
}

/**
 * Planned spend from the itinerary: each step contributes
 * {@link stayStepTotalCost} / {@link transitStepTotalCost} / {@link activityStepTotalCost}
 * (hosted activities roll into their stay — not double-counted).
 */
export function tripItineraryTotalAmount(trip: Trip): number {
  const cur = tripTargetCurrency(trip);
  let sum = 0;
  for (const step of trip.steps ?? []) {
    if (step.stepType === "activity" && step.hostStayStepId) continue;
    const m =
      step.stepType === "stay"
        ? stayStepTotalCost(step, trip.steps)
        : step.stepType === "transit"
          ? transitStepTotalCost(step)
          : activityStepTotalCost(step);
    sum += amountInTripCurrency(m, cur);
  }
  return Math.round(sum * 100) / 100;
}

/** Category rollup from itinerary geometry (not the manual expense ledger). */
export function spendByCategoryFromItinerary(trip: Trip): Record<string, number> {
  const cur = tripTargetCurrency(trip);
  const out: Record<string, number> = {};

  const add = (cat: string, m: Money | null) => {
    const a = amountInTripCurrency(m, cur);
    if (a <= 0) return;
    out[cat] = Math.round(((out[cat] ?? 0) + a) * 100) / 100;
  };

  for (const step of trip.steps ?? []) {
    if (step.stepType === "stay") {
      add("hotels", stayStepLodgingCost(step));
      add("activities", stayLinkedActivitiesCost(step.id, trip.steps));
    } else if (step.stepType === "transit") {
      add("transport", transitStepTotalCost(step));
    } else if (step.stepType === "activity" && !step.hostStayStepId) {
      add("activities", activityStepTotalCost(step));
    }
  }
  return out;
}

/** Per calendar day: each interval price on that interval's start date; transit manual on first leg day. */
export function spendByDayFromItinerary(trip: Trip): DailySpend[] {
  const cur = tripTargetCurrency(trip);
  const map = new Map<string, number>();

  const add = (isoLike: string, money: Money | null | undefined) => {
    const a = amountInTripCurrency(money, cur);
    if (a <= 0) return;
    const key = isoLike.slice(0, 10);
    map.set(key, Math.round(((map.get(key) ?? 0) + a) * 100) / 100);
  };

  for (const step of trip.steps ?? []) {
    if (step.stepType === "stay") {
      for (const int of step.stepIntervals) {
        add(int.startTime, int.price);
      }
    } else if (step.stepType === "transit") {
      const ts = step as TransitStep;
      for (const int of ts.stepIntervals) {
        add(int.startTime, int.price);
      }
      if (ts.totalManualPrice && amountInTripCurrency(ts.totalManualPrice, cur) > 0) {
        const anchor = ts.stepIntervals[0]?.startTime ?? step.startTime;
        add(anchor, ts.totalManualPrice);
      }
    } else if (step.stepType === "activity") {
      for (const int of step.stepIntervals) {
        add(int.startTime, int.price);
      }
    }
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateIso, amount]) => ({ dateIso, amount }));
}

export function cumulativeItinerarySpend(trip: Trip): DailySpend[] {
  let acc = 0;
  return spendByDayFromItinerary(trip).map((d) => {
    acc += d.amount;
    return { dateIso: d.dateIso, amount: Math.round(acc * 100) / 100 };
  });
}
