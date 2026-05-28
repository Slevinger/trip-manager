import type { ExpenseEntry, Trip } from "@/lib/types/trip";
import type { FxMultipliersToTarget } from "@/lib/fx/moneyInTargetCurrency";
import { moneyAmountInTargetCurrency } from "@/lib/fx/moneyInTargetCurrency";
import { collectItineraryPriceLines } from "@/lib/expenses/itineraryPriceLines";

/**
 * Per-traveler net balance: positive = others owe them, negative = they owe.
 * Includes both manual expense entries and obligation receipts from itinerary
 * step intervals. Receipts are split equally among all travelers.
 *
 * @param fx When set, amounts are converted into {@link Trip#currency}
 * before splitting; when omitted, raw numeric amounts are used.
 */
export function computeBalances(trip: Trip, fx?: FxMultipliersToTarget | null): Record<string, number> {
  const target = (trip.currency ?? "").trim().toUpperCase() || "USD";
  const balances: Record<string, number> = {};
  for (const t of trip.travelers) balances[t.id] = 0;

  // Manual expense entries
  for (const e of trip.expenses ?? []) {
    const splitIds = e.splitBetween.length > 0 ? e.splitBetween : [e.paidByTravelerId];
    const amt = moneyAmountInTargetCurrency(e.amount, target, fx);
    const share = amt / splitIds.length;
    balances[e.paidByTravelerId] = (balances[e.paidByTravelerId] ?? 0) + amt;
    for (const id of splitIds) {
      balances[id] = (balances[id] ?? 0) - share;
    }
  }

  // Obligation receipts from itinerary step intervals — split equally among all travelers
  const travelerIds = trip.travelers.map((t) => t.id);
  if (travelerIds.length > 0) {
    const priceLines = collectItineraryPriceLines(trip);
    for (const line of priceLines) {
      if (!line.obligation) continue;
      for (const receipt of line.obligation.receipts) {
        if (!receipt.paidByTravelerId) continue;
        const amt = moneyAmountInTargetCurrency(
          { amount: receipt.amount, currency: receipt.currency },
          target,
          fx
        );
        const share = amt / travelerIds.length;
        balances[receipt.paidByTravelerId] = (balances[receipt.paidByTravelerId] ?? 0) + amt;
        for (const id of travelerIds) {
          balances[id] = (balances[id] ?? 0) - share;
        }
      }
    }
  }

  for (const id of Object.keys(balances)) {
    balances[id] = Math.round(balances[id] * 100) / 100;
  }
  return balances;
}

export interface Settlement {
  fromId: string;
  toId: string;
  amount: number;
  currency: string;
}

/**
 * Greedy settlement: at each step the largest debtor pays down the largest
 * creditor. Yields at most `n - 1` transfers for `n` people.
 */
export function settleBalances(trip: Trip, fx?: FxMultipliersToTarget | null): Settlement[] {
  const balances = computeBalances(trip, fx);
  const currency = trip.currency || "USD";
  const owed = Object.entries(balances)
    .map(([id, amount]) => ({ id, amount }))
    .filter((b) => Math.abs(b.amount) > 0.005);

  const debtors = owed.filter((b) => b.amount < 0).sort((a, b) => a.amount - b.amount); // most negative first
  const creditors = owed.filter((b) => b.amount > 0).sort((a, b) => b.amount - a.amount); // most positive first

  const settlements: Settlement[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const transfer = Math.min(-debtor.amount, creditor.amount);
    if (transfer > 0.005) {
      settlements.push({
        fromId: debtor.id,
        toId: creditor.id,
        amount: Math.round(transfer * 100) / 100,
        currency,
      });
      debtor.amount += transfer;
      creditor.amount -= transfer;
    }
    if (Math.abs(debtor.amount) < 0.01) i += 1;
    if (Math.abs(creditor.amount) < 0.01) j += 1;
  }
  return settlements;
}

export function totalSpent(trip: Trip): number {
  return (trip.expenses ?? []).reduce((acc, e) => acc + e.amount.amount, 0);
}

/** Sums by `ExpenseCategory`, defaulting to "other" when category is missing. */
export function spendByCategory(trip: Trip): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of trip.expenses ?? []) {
    const k = (e.category ?? "other") as string;
    out[k] = (out[k] ?? 0) + e.amount.amount;
  }
  return out;
}

export interface DailySpend {
  dateIso: string;
  amount: number;
}

/** Sums per local date (yyyy-mm-dd). */
export function spendByDay(trip: Trip): DailySpend[] {
  const map = new Map<string, number>();
  for (const e of trip.expenses ?? []) {
    const d = new Date(e.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    map.set(key, (map.get(key) ?? 0) + e.amount.amount);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateIso, amount]) => ({ dateIso, amount }));
}

export function cumulativeSpend(trip: Trip): DailySpend[] {
  let acc = 0;
  return spendByDay(trip).map((d) => {
    acc += d.amount;
    return { dateIso: d.dateIso, amount: Math.round(acc * 100) / 100 };
  });
}

export function nextExpenseId(existing: ExpenseEntry[]): string {
  let n = existing.length + 1;
  while (existing.some((e) => e.id === `exp-${n}`)) n += 1;
  return `exp-${n}`;
}
