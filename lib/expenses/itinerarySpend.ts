import type { Money, Trip, TransitStep } from "@/lib/types/trip";
import type { FxMultipliersToTarget } from "@/lib/fx/moneyInTargetCurrency";
import { moneyAmountInTargetCurrency } from "@/lib/fx/moneyInTargetCurrency";
import {
  activityStepTotalCost,
  stayLinkedActivitiesCost,
  stayStepLodgingCost,
  stayStepTotalCost,
  transitStepTotalCost,
} from "@/lib/trip/stepCosts";
import type { DailySpend } from "@/lib/expenses/settlement";

function tripTargetCurrency(trip: Trip): string {
  return (trip.currency ?? "").trim().toUpperCase() || "USD";
}

function amountInTripCurrency(
  m: Money | null | undefined,
  target: string,
  fx?: FxMultipliersToTarget | null
): number {
  return moneyAmountInTargetCurrency(m, target, fx);
}

/**
 * Planned spend from the itinerary: each step contributes
 * {@link stayStepTotalCost} / {@link transitStepTotalCost} / {@link activityStepTotalCost}
 * (hosted activities roll into their stay — not double-counted).
 *
 * @param fx When set, converts each step total into {@link Trip#currency} using Frankfurter-style
 * multipliers; otherwise only amounts already in the trip currency are counted.
 */
export function tripItineraryTotalAmount(trip: Trip, fx?: FxMultipliersToTarget | null): number {
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
    sum += amountInTripCurrency(m, cur, fx);
  }
  return Math.round(sum * 100) / 100;
}

/** Category rollup from itinerary geometry (not the manual expense ledger). */
export function spendByCategoryFromItinerary(trip: Trip, fx?: FxMultipliersToTarget | null): Record<string, number> {
  const cur = tripTargetCurrency(trip);
  const out: Record<string, number> = {};

  const add = (cat: string, m: Money | null) => {
    const a = amountInTripCurrency(m, cur, fx);
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
export function spendByDayFromItinerary(trip: Trip, fx?: FxMultipliersToTarget | null): DailySpend[] {
  const cur = tripTargetCurrency(trip);
  const map = new Map<string, number>();

  const add = (isoLike: string, money: Money | null | undefined) => {
    const a = amountInTripCurrency(money, cur, fx);
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
      if (ts.totalManualPrice && amountInTripCurrency(ts.totalManualPrice, cur, fx) > 0) {
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

export function cumulativeItinerarySpend(trip: Trip, fx?: FxMultipliersToTarget | null): DailySpend[] {
  let acc = 0;
  return spendByDayFromItinerary(trip, fx).map((d) => {
    acc += d.amount;
    return { dateIso: d.dateIso, amount: Math.round(acc * 100) / 100 };
  });
}
