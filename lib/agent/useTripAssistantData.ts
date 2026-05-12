"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { useFirebaseUser } from "@/lib/auth/useFirebaseUser";
import { subscribeSharedTripThread } from "@/lib/sharedTripThread";
import { subscribeUser } from "@/lib/usersFirestore";
import type { Trip, UserPreferences } from "@/lib/types/trip";
import type {
  SharedTripThreadEntry,
  TripChatMessage,
} from "@/lib/types/user";

export interface UseTripAssistantDataResult {
  user: User | null;
  profilePreferences: UserPreferences | null;
  tripChatMessages: TripChatMessage[];
  globalChatMessages: TripChatMessage[];
  /** Subset of `useFirestore && user.email` resolved for the dock. */
  canPersistMemory: boolean;
}

/**
 * Subscribes to all the chat / memory inputs the assistant consumes for a
 * given trip. Mirrors the fan-out wiring the legacy `TripDetail` component
 * built up directly so any new screen can mount a Smart Dock independently.
 */
export function useTripAssistantData(trip: Trip | null): UseTripAssistantDataResult {
  const { user, useFirestore } = useFirebaseUser();
  const [profilePreferences, setProfilePreferences] = useState<UserPreferences | null>(null);
  const [chatMemory, setChatMemory] = useState<TripChatMessage[]>([]);
  const [sharedThread, setSharedThread] = useState<{
    loaded: boolean;
    entries: SharedTripThreadEntry[];
  }>({ loaded: false, entries: [] });

  const tripId = trip?.id ?? null;

  useEffect(() => {
    if (!useFirestore || !user?.email?.trim()) {
      setProfilePreferences(null);
      setChatMemory([]);
      return () => {};
    }
    return subscribeUser(user.email!, (u) => {
      setProfilePreferences(u?.preferences ?? null);
      setChatMemory(u?.memory ?? []);
    });
  }, [useFirestore, user]);

  useEffect(() => {
    if (!useFirestore || !tripId) {
      setSharedThread({ loaded: false, entries: [] });
      return () => {};
    }
    return subscribeSharedTripThread(
      tripId,
      (rows) => setSharedThread({ loaded: true, entries: rows }),
      () => setSharedThread({ loaded: true, entries: [] })
    );
  }, [useFirestore, tripId]);

  const tripChatMessages = useMemo<TripChatMessage[]>(() => {
    if (!tripId) return [];
    if (!sharedThread.loaded) return [];
    const allForTrip = sharedThread.entries.filter((e) => e.tripId === tripId);
    return allForTrip
      .filter((e) => e.active)
      .slice(-40)
      .map((e) => ({
        tripId: e.tripId,
        from: e.from,
        content: e.content,
        timeStamp: new Date(e.createdAtMs).toISOString(),
        ...(e.memoryCompressed === true ? { memoryCompressed: true as const } : {}),
      }));
  }, [sharedThread.loaded, sharedThread.entries, tripId]);

  const globalChatMessages: TripChatMessage[] = [];

  const canPersistMemory = Boolean(useFirestore && user?.email?.trim());

  return {
    user,
    profilePreferences,
    tripChatMessages,
    globalChatMessages,
    canPersistMemory,
  };
}
