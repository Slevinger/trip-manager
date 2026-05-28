import type { FxMultipliersToTarget } from "@/lib/fx/moneyInTargetCurrency";

/**
 * Frankfurter `from=USD` shape: `rates[c]` = units of `c` per 1 USD.
 * Returns multiplier such that: amount_in_to = amount_in_from * multiplier.
 */
export function multiplierFromToUsingUsdBase(
  from: string,
  to: string,
  usdRates: Record<string, number>
): number {
  const f = from.trim().toUpperCase();
  const t = to.trim().toUpperCase();
  if (f === t) return 1;
  const rf = f === "USD" ? 1 : usdRates[f];
  const rt = t === "USD" ? 1 : usdRates[t];
  if (typeof rf !== "number" || typeof rt !== "number" || !Number.isFinite(rf) || !Number.isFinite(rt) || rf <= 0 || rt <= 0) {
    return Number.NaN;
  }
  const usdPerUnitFrom = f === "USD" ? 1 : 1 / rf;
  const toPerUsd = t === "USD" ? 1 : rt;
  return usdPerUnitFrom * toPerUsd;
}

/** Maps each `sourceCurrency` → multiply into `tripCurrency` (for {@link moneyAmountInTargetCurrency}). */
export function multipliersFromUsdBaseRates(
  usdRates: Record<string, number>,
  tripCurrency: string,
  sourceCurrencies: readonly string[]
): FxMultipliersToTarget {
  const tc = tripCurrency.trim().toUpperCase() || "USD";
  const out: FxMultipliersToTarget = {};
  for (const raw of sourceCurrencies) {
    const s = raw.trim().toUpperCase();
    if (!s || s === tc) continue;
    const m = multiplierFromToUsingUsdBase(s, tc, usdRates);
    if (Number.isFinite(m)) out[s] = m;
  }
  return out;
}
