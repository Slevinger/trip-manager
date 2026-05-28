import type { BaseStepInterval, Money, Obligation, ObligationStatus, Receipt, TransitStep } from "@/lib/types/trip";

/**
 * Sum all receipts whose currency matches the obligation currency.
 * Cross-currency receipts are intentionally excluded — the obligation
 * price and receipts are expected to share a currency.
 */
export function sumReceiptsInObligationCurrency(obligation: Obligation): number {
  return obligation.receipts.reduce((acc, r) => {
    if (r.currency === obligation.currency) return acc + r.amount;
    return acc;
  }, 0);
}

/** Derive payment status from receipt totals vs the obligation price. */
export function getObligationStatus(obligation: Obligation): ObligationStatus {
  const total = sumReceiptsInObligationCurrency(obligation);
  if (total <= 0) return "unpaid";
  if (total >= obligation.price) return "paid";
  return "partially_paid";
}

/** Generate a unique id for a new receipt within an obligation. */
export function nextReceiptId(receipts: Receipt[]): string {
  const maxNum = receipts.reduce((m, r) => {
    const n = parseInt(r.id.replace(/^\D*/, ""), 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `receipt_${maxNum + 1}`;
}

/**
 * Sync an interval's obligation with a new price value.
 * - Clears the obligation when price is removed.
 * - Creates a fresh obligation (empty receipts) when price is first set.
 * - Updates price/currency while preserving existing title and receipts.
 */
export function syncIntervalObligationWithPrice(
  interval: BaseStepInterval,
  newPrice: Money | undefined
): Obligation | undefined {
  if (!newPrice || !Number.isFinite(newPrice.amount) || newPrice.amount <= 0) {
    return undefined;
  }
  const existing = interval.obligation;
  return {
    title: existing?.title ?? interval.title,
    price: newPrice.amount,
    currency: newPrice.currency,
    receipts: existing?.receipts ?? [],
  };
}

/**
 * Sync a transit step's totalManualPriceObligation with a new price value.
 * Same rules as {@link syncIntervalObligationWithPrice}.
 */
export function syncTransitManualObligationWithPrice(
  step: TransitStep,
  newPrice: Money | undefined
): Obligation | undefined {
  if (!newPrice || !Number.isFinite(newPrice.amount) || newPrice.amount <= 0) {
    return undefined;
  }
  const existing = step.totalManualPriceObligation;
  return {
    title: existing?.title ?? step.title,
    price: newPrice.amount,
    currency: newPrice.currency,
    receipts: existing?.receipts ?? [],
  };
}
