"use client";

import { TripPage } from "@/components/trip/TripPage";

/** Eager client mount so `getRedirectResult` runs immediately after OAuth (no lazy-chunk delay). */
export function TripPageGate({ tripId }: { tripId: string }) {
  return <TripPage tripId={tripId} />;
}
