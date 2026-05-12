"use client";

import { useEffect, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import { clearCanonicalTripLiveLocation, updateCanonicalTripLiveLocation } from "@/lib/canonicalTripsFirestore";
import { getDb } from "@/lib/firebase";
import type { Trip } from "@/lib/types/trip";
import type { ViewerDevicePing } from "@/lib/tripTravelerLocationContext";

export const TRIP_LIVE_LOCATION_STORAGE_EVENT = "trip-live-location-opt-in";

function storageKey(tripId: string): string {
  return `tripLiveLoc:v1:${tripId.trim()}`;
}

export function readTripLiveLocationShareEnabled(tripId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(storageKey(tripId)) === "1";
  } catch {
    return false;
  }
}

export function writeTripLiveLocationShareEnabled(tripId: string, enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(tripId), enabled ? "1" : "0");
    window.dispatchEvent(new CustomEvent(TRIP_LIVE_LOCATION_STORAGE_EVENT, { detail: { tripId } }));
  } catch {
    /* ignore */
  }
}

function travelerMayShareLiveLocation(trip: Trip, emailLower: string): boolean {
  const e = emailLower.trim().toLowerCase();
  return trip.travelers.some((t) => t.email?.trim().toLowerCase() === e);
}

const WRITE_THROTTLE_MS = 45_000;

/**
 * When session opt-in is on and the user is a listed traveler, watches device GPS,
 * writes throttled fixes to `canonicalTrips/{id}.liveLocations`, and mirrors the
 * latest fix into `pingRef` for trip-assistant requests.
 */
export function useTripLiveLocationTelemetry(
  tripId: string | null,
  trip: Trip | null,
  opts: {
    userEmail: string | null;
    userDisplayName: string | null;
    useFirestore: boolean;
  },
  pingRef: MutableRefObject<ViewerDevicePing | null>
): { shareEnabled: boolean } {
  const [shareEnabled, setShareEnabled] = useState(false);

  useEffect(() => {
    if (!tripId?.trim()) {
      setShareEnabled(false);
      return;
    }
    const tid = tripId.trim();
    const sync = () => setShareEnabled(readTripLiveLocationShareEnabled(tid));
    sync();
    const onEvt = (e: Event) => {
      const d = (e as CustomEvent<{ tripId?: string }>).detail;
      if (d?.tripId === tid) sync();
    };
    window.addEventListener(TRIP_LIVE_LOCATION_STORAGE_EVENT, onEvt);
    return () => window.removeEventListener(TRIP_LIVE_LOCATION_STORAGE_EVENT, onEvt);
  }, [tripId]);

  const eligible = useMemo(() => {
    const em = opts.userEmail?.trim().toLowerCase();
    if (!em || !trip) return false;
    return travelerMayShareLiveLocation(trip, em);
  }, [opts.userEmail, trip]);

  useEffect(() => {
    pingRef.current = null;
    if (!shareEnabled || !eligible || !opts.useFirestore || !tripId?.trim() || !trip || !opts.userEmail?.trim()) {
      return;
    }
    const db = getDb();
    if (!db || typeof navigator === "undefined" || !navigator.geolocation) return;

    const tid = tripId.trim();
    const key = opts.userEmail.trim().toLowerCase();
    const display = opts.userDisplayName?.trim() || opts.userEmail.split("@")[0] || "Traveler";

    let watchId: number | null = null;
    let lastWrite = 0;

    const onPos = (pos: GeolocationPosition) => {
      const now = Date.now();
      const cap = pos.timestamp && Number.isFinite(pos.timestamp) ? Math.min(now, pos.timestamp) : now;
      pingRef.current = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        capturedAtMs: cap,
        ...(typeof pos.coords.accuracy === "number" && Number.isFinite(pos.coords.accuracy)
          ? { accuracyM: pos.coords.accuracy }
          : {}),
      };
      if (now - lastWrite < WRITE_THROTTLE_MS) return;
      lastWrite = now;
      void updateCanonicalTripLiveLocation(db, tid, key, {
        name: display,
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        updatedAt: new Date(now).toISOString(),
      }).catch(() => {});
    };

    watchId = navigator.geolocation.watchPosition(onPos, () => {}, {
      enableHighAccuracy: false,
      maximumAge: 45_000,
      timeout: 25_000,
    });

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      pingRef.current = null;
      void clearCanonicalTripLiveLocation(db, tid, key).catch(() => {});
    };
  }, [shareEnabled, eligible, opts.useFirestore, opts.userEmail, opts.userDisplayName, trip, tripId, pingRef]);

  return { shareEnabled };
}
