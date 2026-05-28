"use client";

import { useEffect, useMemo, useState } from "react";
import { getClientAuth } from "@/lib/firebase";
import { multipliersFromUsdBaseRates } from "@/lib/fx/multiplierFromUsdRates";
import type { FxMultipliersToTarget } from "@/lib/fx/moneyInTargetCurrency";

export interface UseTripFxMultipliersResult {
  /** Multiply amount in `source` to trip currency (see {@link moneyAmountInTargetCurrency}). */
  multipliers: FxMultipliersToTarget | null;
  loading: boolean;
  error: string | null;
  /** ECB / Frankfurter effective rate date for the cached day. */
  rateDate: string | null;
}

/**
 * Loads USD-base rates (Firestore `fxRatesDaily` via `/api/fx/rates`) and builds multipliers into
 * `targetCurrency` for each source currency on the trip.
 */
export function useTripFxMultipliers(
  targetCurrency: string,
  sourceCurrencies: readonly string[],
  enabled: boolean
): UseTripFxMultipliersResult {
  const target = (targetCurrency ?? "").trim().toUpperCase() || "USD";
  const key = useMemo(() => `${target}|${[...sourceCurrencies].sort().join(",")}`, [target, sourceCurrencies]);

  const [multipliers, setMultipliers] = useState<FxMultipliersToTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateDate, setRateDate] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setMultipliers(null);
      setLoading(false);
      setError(null);
      setRateDate(null);
      return;
    }
    const unique = [...new Set(sourceCurrencies.map((c) => c.trim().toUpperCase()).filter(Boolean))].filter(
      (c) => c !== target
    );
    if (unique.length === 0) {
      setMultipliers({});
      setLoading(false);
      setError(null);
      setRateDate(null);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setMultipliers(null);
    setRateDate(null);

    void (async () => {
      try {
        const auth = getClientAuth();
        const token = await auth?.currentUser?.getIdToken();
        if (!token) {
          setError("Not signed in");
          setMultipliers(null);
          setLoading(false);
          return;
        }

        const needRatesFor = [...new Set([...unique, ...(target !== "USD" ? [target] : [])])].sort();
        const date = new Date().toISOString().slice(0, 10);
        const qs = new URLSearchParams({
          date,
          targets: needRatesFor.join(","),
        });
        const res = await fetch(`/api/fx/rates?${qs.toString()}`, {
          signal: ac.signal,
          headers: { Authorization: `Bearer ${token}` },
        });
        if (ac.signal.aborted) return;
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          rates?: Record<string, number>;
          effectiveDate?: string;
        };
        if (!res.ok) {
          setError(j.error?.trim() || `Request failed (${res.status})`);
          setMultipliers(null);
          setLoading(false);
          return;
        }
        const usdRates = j.rates ?? {};
        const mult = multipliersFromUsdBaseRates(usdRates, target, unique);
        for (const s of unique) {
          if (mult[s] == null || !Number.isFinite(mult[s])) {
            setError(`Missing FX for ${s} → ${target}.`);
            setMultipliers(null);
            setLoading(false);
            setRateDate(null);
            return;
          }
        }
        setMultipliers(mult);
        setRateDate(typeof j.effectiveDate === "string" ? j.effectiveDate : date);
        setError(null);
      } catch (e) {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setMultipliers(null);
        setRateDate(null);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [enabled, key, target]);

  return { multipliers, loading, error, rateDate };
}
