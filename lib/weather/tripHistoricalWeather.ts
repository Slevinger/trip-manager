import type { WeatherDay } from "@/lib/types/trip";

const DAY_MS = 86_400_000;
const ERA5_ENDPOINT = "https://archive-api.open-meteo.com/v1/era5";
const MAX_TRIP_HIST_DAYS = 45;

function utcDateOnlyFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addUtcDays(dayStr: string, delta: number): string {
  const [y, m, d] = dayStr.split("-").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dayStr;
  return utcDateOnlyFromMs(Date.UTC(y, m - 1, d) + delta * DAY_MS);
}

/** Shift YYYY-MM-DD by whole years in UTC (Feb 29 may roll; acceptable for travel heuristics). */
function addYearsToIsoDay(isoDay: string, deltaYears: number): string {
  const [y, m, d] = isoDay.slice(0, 10).split("-").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return isoDay;
  return utcDateOnlyFromMs(Date.UTC(y + deltaYears, m - 1, d));
}

function countTripDaysInclusive(start: string, end: string): number {
  const a = Date.UTC(
    Number.parseInt(start.slice(0, 4), 10),
    Number.parseInt(start.slice(5, 7), 10) - 1,
    Number.parseInt(start.slice(8, 10), 10)
  );
  const b = Date.UTC(
    Number.parseInt(end.slice(0, 4), 10),
    Number.parseInt(end.slice(5, 7), 10) - 1,
    Number.parseInt(end.slice(8, 10), 10)
  );
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.floor((b - a) / DAY_MS) + 1;
}

interface Era5DailyResponse {
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    weather_code?: number[];
  };
  error?: boolean;
  reason?: string;
}

async function fetchEra5DailyRange(args: {
  lat: number;
  lon: number;
  startDateIso: string;
  endDateIso: string;
}): Promise<WeatherDay[]> {
  const url = new URL(ERA5_ENDPOINT);
  url.searchParams.set("latitude", String(args.lat));
  url.searchParams.set("longitude", String(args.lon));
  url.searchParams.set("start_date", args.startDateIso.slice(0, 10));
  url.searchParams.set("end_date", args.endDateIso.slice(0, 10));
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code"
  );
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString(), { next: { revalidate: 86_400 } });
  const json = (await res.json()) as Era5DailyResponse;
  if (!res.ok || json.error === true) {
    throw new Error(json.reason ?? `era5 ${res.status}`);
  }
  const time = json.daily?.time ?? [];
  const tmax = json.daily?.temperature_2m_max ?? [];
  const tmin = json.daily?.temperature_2m_min ?? [];
  const precip = json.daily?.precipitation_sum ?? [];
  const codes = json.daily?.weather_code ?? [];

  const out: WeatherDay[] = [];
  for (let i = 0; i < time.length; i += 1) {
    out.push({
      dateIso: time[i],
      tempMaxC: typeof tmax[i] === "number" ? tmax[i] : Number.NaN,
      tempMinC: typeof tmin[i] === "number" ? tmin[i] : Number.NaN,
      precipMm: typeof precip[i] === "number" ? precip[i] : undefined,
      weatherCode: typeof codes[i] === "number" ? codes[i] : 0,
    });
  }
  return out;
}

/**
 * When a trip is outside the ~16-day forecast window, align **trip calendar days** with
 * ERA5 reanalysis for the **same month/day one calendar year earlier** (not a future forecast).
 */
export async function fetchTripHistoricalProxyDaily(args: {
  lat: number;
  lon: number;
  tripStartIso: string;
  tripEndIso: string;
}): Promise<{ proxyYear: number; daily: WeatherDay[] } | null> {
  const ts = args.tripStartIso.slice(0, 10);
  const te = args.tripEndIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ts) || !/^\d{4}-\d{2}-\d{2}$/.test(te) || te < ts) {
    return null;
  }
  const nDays = countTripDaysInclusive(ts, te);
  if (nDays <= 0 || nDays > MAX_TRIP_HIST_DAYS) return null;

  const histStart = addYearsToIsoDay(ts, -1);
  const histEnd = addYearsToIsoDay(te, -1);
  const proxyYear = Number.parseInt(histStart.slice(0, 4), 10);
  if (!Number.isFinite(proxyYear) || proxyYear < 1941) return null;

  let eraRows: WeatherDay[];
  try {
    eraRows = await fetchEra5DailyRange({
      lat: args.lat,
      lon: args.lon,
      startDateIso: histStart,
      endDateIso: histEnd,
    });
  } catch {
    return null;
  }

  const byHist = new Map(eraRows.map((r) => [r.dateIso.slice(0, 10), r]));
  const daily: WeatherDay[] = [];
  for (let d = ts; d <= te; d = addUtcDays(d, 1)) {
    const histKey = addYearsToIsoDay(d, -1);
    const row = byHist.get(histKey);
    if (!row || !Number.isFinite(row.tempMaxC)) continue;
    daily.push({
      dateIso: d,
      tempMaxC: row.tempMaxC,
      tempMinC: row.tempMinC,
      precipMm: row.precipMm,
      weatherCode: row.weatherCode,
    });
  }
  if (daily.length === 0) return null;
  return { proxyYear, daily };
}
