"use client";

import type { Trip } from "@/lib/types/trip";
import { useTripAgentViewerPingRef } from "@/lib/agent/tripAgentViewerPingContext";
import { useFirebaseUser } from "@/lib/auth/useFirebaseUser";
import { useTripLiveLocationTelemetry } from "@/lib/trip/useTripLiveLocationTelemetry";

/**
 * Runs GPS → Firestore sync when the traveler opts in (session flag). Updates the
 * shared ping ref consumed by {@link useTripAssistant} for LLM requests.
 */
export function TripLiveLocationTelemetry({
  tripId,
  trip,
}: {
  tripId: string | null;
  trip: Trip | null;
}) {
  const { user, useFirestore } = useFirebaseUser();
  const pingRef = useTripAgentViewerPingRef();
  useTripLiveLocationTelemetry(
    tripId,
    trip,
    {
      userEmail: user?.email?.trim() ?? null,
      userDisplayName: user?.displayName?.trim() ?? null,
      useFirestore,
    },
    pingRef
  );
  return null;
}
