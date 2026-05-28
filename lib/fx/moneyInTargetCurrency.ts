import type { Money } from "@/lib/types/trip";

/** Maps source ISO currency → multiply `amount_in_source` to get trip target currency. */
export type FxMultipliersToTarget = Record<string, number>;

/**
 * Converts a {@link Money} amount into `targetCurrency` using Frankfurter-style multipliers
 * (`amount_target = amount_source * multipliers[source]`). When `multipliers` is omitted, only
 * amounts already in `targetCurrency` count (legacy behaviour).
 */
export function moneyAmountInTargetCurrency(
  m: Money | null | undefined,
  targetCurrency: string,
  multipliers?: FxMultipliersToTarget | null
): number {
  if (!m || !Number.isFinite(m.amount)) return 0;
  const from = (m.currency ?? "").trim().toUpperCase();
  const target = (targetCurrency ?? "").trim().toUpperCase() || "USD";
  if (from === target) return m.amount;
  if (!multipliers) return 0;
  const k = multipliers[from];
  if (k == null || !Number.isFinite(k)) return 0;
  return m.amount * k;
}
