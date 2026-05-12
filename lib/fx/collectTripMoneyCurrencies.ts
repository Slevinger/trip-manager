import type { Money, Trip } from "@/lib/types/trip";

function addMoneyCurrency(set: Set<string>, m: Money | null | undefined, targetUpper: string): void {
  if (!m || !Number.isFinite(m.amount) || m.amount === 0) return;
  const c = (m.currency ?? "").trim().toUpperCase();
  if (c && c !== targetUpper) set.add(c);
}

function walkStepsForMoney(trip: Trip, targetUpper: string, set: Set<string>): void {
  for (const step of trip.steps ?? []) {
    if (step.stepType === "stay") {
      for (const int of step.stepIntervals) addMoneyCurrency(set, int.price, targetUpper);
    } else if (step.stepType === "transit") {
      for (const int of step.stepIntervals) addMoneyCurrency(set, int.price, targetUpper);
      addMoneyCurrency(set, step.totalManualPrice, targetUpper);
    } else if (step.stepType === "activity") {
      for (const int of step.stepIntervals) addMoneyCurrency(set, int.price, targetUpper);
    }
  }
}

function walkBudgetCaps(trip: Trip, targetUpper: string, set: Set<string>): void {
  const b = trip.budget;
  if (!b) return;
  addMoneyCurrency(set, b.totalBudget, targetUpper);
  const cats = b.categories;
  if (!cats) return;
  for (const m of Object.values(cats)) addMoneyCurrency(set, m, targetUpper);
}

/**
 * Distinct ISO currency codes appearing on monetary fields of the trip, excluding `targetCurrency`
 * (case-insensitive). Used to fetch FX only for pairs we need.
 */
export function collectTripMoneyCurrenciesExceptTarget(trip: Trip, targetCurrency: string): string[] {
  const targetUpper = (targetCurrency ?? "").trim().toUpperCase() || "USD";
  const set = new Set<string>();
  walkStepsForMoney(trip, targetUpper, set);
  for (const e of trip.expenses ?? []) addMoneyCurrency(set, e.amount, targetUpper);
  walkBudgetCaps(trip, targetUpper, set);
  return Array.from(set).sort();
}
