"use client";

import { useEffect, useRef } from "react";
import { logCaughtException } from "@/lib/logCaughtException";
import { mergeAssistantThreadRecommendationsIntoTrip } from "@/lib/tripRecommendations";
import type { Trip } from "@/lib/types/trip";
import type { SharedTripThreadEntry } from "@/lib/types/user";

/**
 * When the shared assistant thread carries `recommendationsJson` on assistant rows
 * (written at turn-append time), merge any missing recommendation ids into the canonical
 * trip so collaborators and secondary devices pick up the same suggestion queue.
 */
export function useTripThreadRecommendationsSync(opts: {
  trip: Trip | null;
  threadLoaded: boolean;
  threadEntries: SharedTripThreadEntry[];
  canPersist: boolean;
  persistTrip: (next: Trip) => Promise<void>;
}): void {
  const persistRef = useRef(opts.persistTrip);
  persistRef.current = opts.persistTrip;

  useEffect(() => {
    const { trip, threadLoaded, threadEntries, canPersist } = opts;
    if (!trip || !threadLoaded || !canPersist) return;
    const merged = mergeAssistantThreadRecommendationsIntoTrip(trip, threadEntries);
    if (!merged) return;
    void persistRef.current(merged).catch((e) =>
      logCaughtException(e, "useTripThreadRecommendationsSync/persistMergedRecommendations")
    );
  }, [opts.trip, opts.threadLoaded, opts.threadEntries, opts.canPersist]);
}
