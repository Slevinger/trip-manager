"use client";

import { useEffect, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import { getClientAuth } from "@/lib/firebase";
import { logCaughtException } from "@/lib/logCaughtException";
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
  } catch (e) {
    logCaughtException(e, "useTripLiveLocationTelemetry/persistSharePreference");
  }
}

const WRITE_THROTTLE_MS = 45_000;

async function postLiveLocation(opts: {
  tripId: string;
  locationKey: string;
  name: string;
  lat: number;
  lon: number;
  updatedAt: string;
}): Promise<void> {
  const auth = getClientAuth();
  const token = await auth?.currentUser?.getIdToken();
  if (!token) return;
  const res = await fetch("/api/trip/live-location", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tripId: opts.tripId,
      locationKey: opts.locationKey,
      name: opts.name,
      lat: opts.lat,
      lon: opts.lon,
      updatedAt: opts.updatedAt,
    }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error?.trim() || `HTTP ${res.status}`);
  }
}

async function deleteLiveLocation(tripId: string, locationKey: string): Promise<void> {
  const auth = getClientAuth();
  const token = await auth?.currentUser?.getIdToken();
  if (!token) return;
  const u = new URL("/api/trip/live-location", typeof window !== "undefined" ? window.location.origin : "http://localhost");
  u.searchParams.set("tripId", tripId);
  u.searchParams.set("locationKey", locationKey);
  await fetch(u.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch((e) => logCaughtException(e, "useTripLiveLocationTelemetry/deleteLiveLocation"));
}

/**
 * When session opt-in is on and the user is a listed traveler, watches device GPS,
 * persists throttled fixes via **POST /api/trip/live-location** (Admin SDK), and mirrors
 * the latest fix into `pingRef` for trip-assistant requests.
 *
 * Avoids client `setDoc` on `canonicalTrips/{id}` while a trip snapshot is active — that
 * pattern has triggered Firestore 12.x watch internal assertion failures.
 *
 * Uses **Firebase Auth uid** as the `liveLocations` map key (not email).
 */
export function useTripLiveLocationTelemetry(
  tripId: string | null,
  trip: Trip | null,
  opts: {
    userUid: string | null;
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

  /** Stable while traveler emails unchanged — avoids re-subscribing geolocation on every Firestore trip snapshot. */
  const travelerEmailsFingerprint = useMemo(
    () =>
      (trip?.travelers ?? [])
        .map((tr) => (tr.email ?? "").trim().toLowerCase())
        .filter(Boolean)
        .sort()
        .join("\0"),
    [trip]
  );

  const eligible = useMemo(() => {
    const em = opts.userEmail?.trim().toLowerCase();
    if (!em) return false;
    const emails = travelerEmailsFingerprint.split("\0").filter(Boolean);
    return emails.includes(em);
  }, [opts.userEmail, travelerEmailsFingerprint]);

  /** Single primitive gate so the geolocation effect dependency list length never changes between renders (HMR-safe). */
  const geoGateKey = [
    shareEnabled ? "1" : "0",
    eligible ? "1" : "0",
    opts.useFirestore ? "1" : "0",
    opts.userEmail ?? "",
    opts.userUid ?? "",
    opts.userDisplayName ?? "",
    tripId ?? "",
  ].join("|");

  useEffect(() => {
    pingRef.current = null;
    if (
      !shareEnabled ||
      !eligible ||
      !opts.useFirestore ||
      !tripId?.trim() ||
      !opts.userEmail?.trim() ||
      !opts.userUid?.trim()
    ) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const tid = tripId.trim();
    const key = opts.userUid.trim();
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
      void postLiveLocation({
        tripId: tid,
        locationKey: key,
        name: display,
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        updatedAt: new Date(now).toISOString(),
      }).catch((e) => logCaughtException(e, "useTripLiveLocationTelemetry/postLiveLocation"));
    };

    watchId = navigator.geolocation.watchPosition(onPos, () => {}, {
      enableHighAccuracy: false,
      maximumAge: 45_000,
      timeout: 25_000,
    });

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      pingRef.current = null;
      void deleteLiveLocation(tid, key);
    };
  }, [geoGateKey, pingRef]);

  return { shareEnabled };
}
