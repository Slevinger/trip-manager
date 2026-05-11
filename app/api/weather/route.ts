import { NextResponse } from "next/server";
import { fetchOpenMeteoDaily } from "@/lib/weather/openMeteo";
import { getSeasonalWeatherOutlook } from "@/lib/weather/seasonalOutlookAnthropic";
import { fetchTripHistoricalProxyDaily } from "@/lib/weather/tripHistoricalWeather";

const MAX_RANGE_DAYS = 16;
const DAY_MS = 86_400_000;

function utcDateOnlyFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addUtcDays(dayStr: string, delta: number): string {
  const [y, m, d] = dayStr.split("-").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dayStr;
  return utcDateOnlyFromMs(Date.UTC(y, m - 1, d) + delta * DAY_MS);
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * Open-Meteo `/v1/forecast` daily data is only available for a rolling ~16-day
 * window from **today** (not from an arbitrary trip start). Intersect the trip
 * with that window; if the trip is entirely beyond the horizon, request the
 * next available days as a regional preview (avoids 400s from the upstream API).
 */
export type WeatherApiRangeMode = "trip" | "nearby_preview";

function forecastRequestRange(startIso?: string, endIso?: string): {
  startDateIso: string;
  endDateIso: string;
  mode: WeatherApiRangeMode;
} {
  const todayStr = utcDateOnlyFromMs(Date.now());
  const lastForecastStr = addUtcDays(todayStr, MAX_RANGE_DAYS - 1);

  let tripStart = startIso?.slice(0, 10) ?? todayStr;
  let tripEnd = endIso?.slice(0, 10) ?? tripStart;
  if (tripStart < todayStr) tripStart = todayStr;
  if (tripEnd < tripStart) tripEnd = tripStart;

  let effStart = maxDate(tripStart, todayStr);
  let effEnd = minDate(tripEnd, lastForecastStr);
  let mode: WeatherApiRangeMode = "trip";
  if (effStart > effEnd) {
    mode = "nearby_preview";
    effStart = todayStr;
    effEnd = lastForecastStr;
  }
  effEnd = minDate(effEnd, addUtcDays(effStart, MAX_RANGE_DAYS - 1));
  return { startDateIso: effStart, endDateIso: effEnd, mode };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const latRaw = url.searchParams.get("lat");
  const lonRaw = url.searchParams.get("lon");
  const lat = Number.parseFloat(latRaw ?? "");
  const lon = Number.parseFloat(lonRaw ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat/lon required" }, { status: 400 });
  }
  const startIso = url.searchParams.get("start") ?? undefined;
  const endIso = url.searchParams.get("end") ?? undefined;
  const { startDateIso, endDateIso, mode } = forecastRequestRange(startIso, endIso);
  const tripStartRaw = startIso?.slice(0, 10);
  const tripEndRaw = endIso?.slice(0, 10);
  const destHints = url.searchParams.get("destHints")?.trim().slice(0, 500) ?? "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();

  try {
    /** Full trip window (ERA5 same calendar dates −1 year) for merging with forecast on trip-only UI. */
    const histPromise =
      tripStartRaw && tripEndRaw && tripStartRaw <= tripEndRaw
        ? fetchTripHistoricalProxyDaily({
            lat,
            lon,
            tripStartIso: tripStartRaw,
            tripEndIso: tripEndRaw,
          })
        : Promise.resolve(null);

    const outlookPromise =
      mode === "nearby_preview" && anthropicKey && tripStartRaw && tripEndRaw
        ? getSeasonalWeatherOutlook({
            apiKey: anthropicKey,
            lat,
            lon,
            tripStartIso: tripStartRaw,
            tripEndIso: tripEndRaw,
            destHints,
          })
        : Promise.resolve(null);

    const [daily, tripHistorical, seasonalOutlook] = await Promise.all([
      fetchOpenMeteoDaily({
        lat,
        lon,
        startDateIso,
        endDateIso,
      }),
      histPromise,
      outlookPromise,
    ]);

    return NextResponse.json(
      {
        daily,
        range: { mode, startDateIso, endDateIso },
        tripHistorical: tripHistorical ?? undefined,
        seasonalOutlook: seasonalOutlook ?? undefined,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=900, s-maxage=1800, stale-while-revalidate=3600",
        },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "weather error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
