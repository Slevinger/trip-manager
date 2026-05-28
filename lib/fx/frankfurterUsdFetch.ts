const FX_API = "https://api.frankfurter.app";

/**
 * Fetches ECB rates with base USD for a calendar day. `rates[c]` = units of `c` per 1 USD.
 * Batches `to` to stay within URL limits.
 */
export async function frankfurterUsdRatesForDate(
  dateYyyyMmDd: string,
  isoCodes: readonly string[],
  signal?: AbortSignal
): Promise<{ date: string; rates: Record<string, number> } | null> {
  const cleaned = [...new Set(isoCodes.map((c) => c.trim().toUpperCase()).filter((c) => c && c !== "USD"))];
  if (cleaned.length === 0) return { date: dateYyyyMmDd, rates: {} };

  const merged: Record<string, number> = {};
  let effectiveDate = dateYyyyMmDd;
  const chunk = 12;

  for (let i = 0; i < cleaned.length; i += chunk) {
    const part = cleaned.slice(i, i + chunk);
    const toParam = part.map((c) => encodeURIComponent(c)).join(",");
    const url = `${FX_API}/${encodeURIComponent(dateYyyyMmDd)}?from=USD&to=${toParam}`;
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { date?: string; rates?: Record<string, number> };
    if (typeof j.date === "string" && j.date.trim()) effectiveDate = j.date.trim();
    const rates = j.rates ?? {};
    for (const [k, v] of Object.entries(rates)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) merged[k.toUpperCase()] = v;
    }
  }

  return { date: effectiveDate, rates: merged };
}
