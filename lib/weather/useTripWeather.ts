"use client";

import { useEffect, useMemo, useState } from "react";
import type { Trip, WeatherDay } from "@/lib/types/trip";
import { tripDestinationCentroid } from "@/lib/trip/tripCentroid";

/** Mirrors `/api/weather` `range` when the trip is outside Open-Meteo’s rolling ~16-day horizon. */
export type TripWeatherRange =
  | { mode: "trip"; startDateIso?: string; endDateIso?: string }
  | { mode: "nearby_preview"; startDateIso: string; endDateIso: string };

export type TripHistoricalWeather = {
  proxyYear: number;
  daily: WeatherDay[];
};

type State = {
  loading: boolean;
  daily: WeatherDay[] | null;
  error: string | null;
  weatherRange: TripWeatherRange | null;
  /** Same calendar dates as the trip, ERA5 reanalysis one year earlier (when forecast is `nearby_preview`). */
  tripHistorical: TripHistoricalWeather | null;
  /** Optional Claude + web_search seasonal blurb (`WEATHER_SEASONAL_AGENT=1`). */
  seasonalOutlook: string | null;
};

const cache = new Map<
  string,
  {
    fetchedAtMs: number;
    daily: WeatherDay[];
    weatherRange: TripWeatherRange;
    tripHistorical: TripHistoricalWeather | null;
    seasonalOutlook: string | null;
  }
>();
const CACHE_MS = 30 * 60 * 1000;

/**
 * Fetches a 5-7 day weather preview for the trip's destination centroid.
 * Lightweight client cache so dashboard cards don't refetch on every render.
 */
function parseWeatherRange(json: {
  range?: { mode?: string; startDateIso?: string; endDateIso?: string };
}): TripWeatherRange {
  const r = json.range;
  if (r?.mode === "nearby_preview" && typeof r.startDateIso === "string" && typeof r.endDateIso === "string") {
    return { mode: "nearby_preview", startDateIso: r.startDateIso, endDateIso: r.endDateIso };
  }
  if (r?.mode === "trip") {
    return {
      mode: "trip",
      startDateIso: typeof r.startDateIso === "string" ? r.startDateIso : undefined,
      endDateIso: typeof r.endDateIso === "string" ? r.endDateIso : undefined,
    };
  }
  return { mode: "trip" };
}

function destinationHints(trip: Trip): string {
  return trip.destinations
    .map((d) => d.title)
    .filter(Boolean)
    .join(" · ")
    .slice(0, 400);
}

export function useTripWeather(trip: Trip | null | undefined): State {
  const [state, setState] = useState<State>({
    loading: false,
    daily: null,
    error: null,
    weatherRange: null,
    tripHistorical: null,
    seasonalOutlook: null,
  });

  const fetchKey = useMemo(() => {
    if (!trip) return "";
    const centroid = tripDestinationCentroid(trip);
    if (!centroid) return "";
    const hints = destinationHints(trip);
    return `${trip.id}:${centroid.lat.toFixed(2)}:${centroid.lon.toFixed(2)}:${trip.startDate}:${trip.endDate}:${hints}`;
  }, [trip]);

  useEffect(() => {
    const centroid = tripDestinationCentroid(trip);
    if (!trip || !centroid) {
      setState({
        loading: false,
        daily: null,
        error: null,
        weatherRange: null,
        tripHistorical: null,
        seasonalOutlook: null,
      });
      return;
    }
    const hints = destinationHints(trip);
    const key = fetchKey;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.fetchedAtMs < CACHE_MS) {
      setState({
        loading: false,
        daily: hit.daily,
        error: null,
        weatherRange: hit.weatherRange,
        tripHistorical: hit.tripHistorical,
        seasonalOutlook: hit.seasonalOutlook,
      });
      return;
    }

    let cancelled = false;
    setState({
      loading: true,
      daily: null,
      error: null,
      weatherRange: null,
      tripHistorical: null,
      seasonalOutlook: null,
    });
    void (async () => {
      try {
        const url = new URL("/api/weather", window.location.origin);
        url.searchParams.set("lat", String(centroid.lat));
        url.searchParams.set("lon", String(centroid.lon));
        if (trip.startDate) url.searchParams.set("start", trip.startDate);
        if (trip.endDate) url.searchParams.set("end", trip.endDate);
        if (hints) url.searchParams.set("destHints", hints);
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`weather ${res.status}`);
        const json = (await res.json().catch(() => ({}))) as {
          daily?: WeatherDay[];
          range?: { mode?: string; startDateIso?: string; endDateIso?: string };
          tripHistorical?: { proxyYear?: number; daily?: WeatherDay[] };
          seasonalOutlook?: string;
        };
        if (cancelled) return;
        const daily = Array.isArray(json.daily) ? json.daily : [];
        const weatherRange = parseWeatherRange(json);
        let tripHistorical: TripHistoricalWeather | null = null;
        const th = json.tripHistorical;
        if (
          th &&
          typeof th.proxyYear === "number" &&
          Number.isFinite(th.proxyYear) &&
          Array.isArray(th.daily) &&
          th.daily.length > 0
        ) {
          tripHistorical = { proxyYear: th.proxyYear, daily: th.daily };
        }
        const seasonalOutlook =
          typeof json.seasonalOutlook === "string" && json.seasonalOutlook.trim()
            ? json.seasonalOutlook.trim()
            : null;
        cache.set(key, {
          fetchedAtMs: Date.now(),
          daily,
          weatherRange,
          tripHistorical,
          seasonalOutlook,
        });
        setState({ loading: false, daily, error: null, weatherRange, tripHistorical, seasonalOutlook });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "weather error";
        setState({
          loading: false,
          daily: null,
          error: msg,
          weatherRange: null,
          tripHistorical: null,
          seasonalOutlook: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchKey]);

  return state;
}

/** Map Open-Meteo WMO weather codes to a display emoji + label. */
export function weatherCodeIcon(code: number | undefined): string {
  if (code == null) return "🌡";
  if (code === 0) return "☀️";
  if (code <= 3) return "⛅️";
  if (code <= 48) return "🌫";
  if (code <= 67) return "🌧";
  if (code <= 77) return "❄️";
  if (code <= 82) return "🌧";
  if (code <= 86) return "❄️";
  if (code <= 99) return "⛈";
  return "🌡";
}
