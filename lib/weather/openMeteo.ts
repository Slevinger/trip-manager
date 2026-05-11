import type { WeatherDay } from "@/lib/types/trip";

interface OpenMeteoDailyResponse {
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    weather_code?: number[];
  };
}

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/**
 * Fetches daily forecast (max/min temp, precip, WMO weather code) for a point
 * over a date range. Open-Meteo is free, no API key, and rate-limited per IP;
 * keep callers cached.
 */
export async function fetchOpenMeteoDaily(args: {
  lat: number;
  lon: number;
  startDateIso?: string;
  endDateIso?: string;
}): Promise<WeatherDay[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("latitude", String(args.lat));
  url.searchParams.set("longitude", String(args.lon));
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code"
  );
  url.searchParams.set("timezone", "auto");
  if (args.startDateIso) url.searchParams.set("start_date", args.startDateIso.slice(0, 10));
  if (args.endDateIso) url.searchParams.set("end_date", args.endDateIso.slice(0, 10));

  const res = await fetch(url.toString(), { next: { revalidate: 1800 } });
  const json = (await res.json()) as OpenMeteoDailyResponse & {
    error?: boolean;
    reason?: string;
  };
  if (!res.ok) {
    const hint = json.reason ? `: ${json.reason}` : "";
    throw new Error(`open-meteo ${res.status}${hint}`);
  }
  if (json.error === true) {
    throw new Error(json.reason ?? "open-meteo rejected request");
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
