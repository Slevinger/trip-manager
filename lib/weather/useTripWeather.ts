"use client";

import { useEffect, useState } from "react";
import type { Trip, WeatherDay } from "@/lib/types/trip";
import { tripDestinationCentroid } from "@/lib/trip/tripCentroid";

type State = { loading: boolean; daily: WeatherDay[] | null; error: string | null };

const cache = new Map<string, { fetchedAtMs: number; daily: WeatherDay[] }>();
const CACHE_MS = 30 * 60 * 1000;

/**
 * Fetches a 5-7 day weather preview for the trip's destination centroid.
 * Lightweight client cache so dashboard cards don't refetch on every render.
 */
export function useTripWeather(trip: Trip | null | undefined): State {
  const [state, setState] = useState<State>({ loading: false, daily: null, error: null });

  useEffect(() => {
    const centroid = tripDestinationCentroid(trip);
    if (!trip || !centroid) {
      setState({ loading: false, daily: null, error: null });
      return;
    }
    const key = `${trip.id}:${centroid.lat.toFixed(2)}:${centroid.lon.toFixed(2)}:${trip.startDate}:${trip.endDate}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.fetchedAtMs < CACHE_MS) {
      setState({ loading: false, daily: hit.daily, error: null });
      return;
    }

    let cancelled = false;
    setState({ loading: true, daily: null, error: null });
    void (async () => {
      try {
        const url = new URL("/api/weather", window.location.origin);
        url.searchParams.set("lat", String(centroid.lat));
        url.searchParams.set("lon", String(centroid.lon));
        if (trip.startDate) url.searchParams.set("start", trip.startDate);
        if (trip.endDate) url.searchParams.set("end", trip.endDate);
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`weather ${res.status}`);
        const json = (await res.json().catch(() => ({}))) as { daily?: WeatherDay[] };
        if (cancelled) return;
        const daily = Array.isArray(json.daily) ? json.daily : [];
        cache.set(key, { fetchedAtMs: Date.now(), daily });
        setState({ loading: false, daily, error: null });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "weather error";
        setState({ loading: false, daily: null, error: msg });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trip?.id, trip?.startDate, trip?.endDate]);

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
