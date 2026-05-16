"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { userPrimaryEmailLower } from "@/lib/auth/userPrimaryEmailLower";
import { useFirebaseUser } from "@/lib/auth/useFirebaseUser";
import { subscribeSharedTripThreadShared } from "@/lib/sharedTripThread";
import { subscribeUser } from "@/lib/usersFirestore";
import type { Trip, UserPreferences } from "@/lib/types/trip";
import type {
  SharedTripThreadEntry,
  TripChatMessage,
} from "@/lib/types/user";

export interface UseTripAssistantDataResult {
  user: User | null;
  /** Lowercase email from {@link User.email} or linked provider (for shared thread + persist). */
  userEmailLower: string | null;
  profilePreferences: UserPreferences | null;
  tripChatMessages: TripChatMessage[];
  globalChatMessages: TripChatMessage[];
  /** True when Firestore is configured, user is signed in, and an email could be resolved. */
  canPersistMemory: boolean;
  /** Raw shared thread rows (for merging structured suggestions into the trip). */
  sharedTripThread: { loaded: boolean; entries: SharedTripThreadEntry[] };
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
  const userEmailLower = useMemo(() => userPrimaryEmailLower(user), [user]);

  useEffect(() => {
    if (!useFirestore || !userEmailLower) {
      setProfilePreferences(null);
      setChatMemory([]);
      return () => {};
    }
    return subscribeUser(userEmailLower, (u) => {
      setProfilePreferences(u?.preferences ?? null);
      setChatMemory(u?.memory ?? []);
    });
  }, [useFirestore, userEmailLower]);

  useEffect(() => {
    if (!useFirestore || !tripId || !user) {
      setSharedThread({ loaded: false, entries: [] });
      return () => {};
    }
    return subscribeSharedTripThreadShared(
      tripId,
      (rows) => setSharedThread({ loaded: true, entries: rows }),
      (err) => {
        console.warn("[subscribeSharedTripThread]", err);
        setSharedThread((prev) => ({ ...prev, loaded: true }));
      }
    );
  }, [useFirestore, tripId, user]);

  const tripChatMessages = useMemo<TripChatMessage[]>(() => {
    if (!tripId) return [];
    if (!sharedThread.loaded) return [];
    const allForTrip = sharedThread.entries.filter((e) => e.tripId === tripId);
    return allForTrip
      .filter((e) => e.active !== false)
      .slice(-40)
      .map((e) => ({
        tripId: e.tripId,
        from: e.from,
        ...(e.fromDisplayName ? { fromDisplayName: e.fromDisplayName } : {}),
        content: e.content,
        timeStamp: new Date(e.createdAtMs).toISOString(),
        ...(e.memoryCompressed === true ? { memoryCompressed: true as const } : {}),
      }));
  }, [sharedThread.loaded, sharedThread.entries, tripId]);

  const globalChatMessages: TripChatMessage[] = [];

  const canPersistMemory = Boolean(useFirestore && user && userEmailLower);

  return {
    user,
    userEmailLower,
    profilePreferences,
    tripChatMessages,
    globalChatMessages,
    canPersistMemory,
    sharedTripThread: { loaded: sharedThread.loaded, entries: sharedThread.entries },
  };
}
