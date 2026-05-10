"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { useFirebaseUser } from "@/lib/auth/useFirebaseUser";
import { messagesForTrip } from "@/lib/tripChatMessages";
import { loadTripChatLocal } from "@/lib/tripChatLocalStore";
import { subscribeSharedTripThread } from "@/lib/sharedTripThread";
import {
  subscribeImmutableMemoryQueueEntries,
  subscribeTripAssistantChat,
  subscribeUser,
} from "@/lib/usersFirestore";
import type { Trip, UserPreferences } from "@/lib/types/trip";
import type {
  ImmutableMemoryQueueEntry,
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
  const [immutableQueue, setImmutableQueue] = useState<{
    loaded: boolean;
    entries: ImmutableMemoryQueueEntry[];
  }>({ loaded: false, entries: [] });
  const [sharedThread, setSharedThread] = useState<{
    loaded: boolean;
    entries: SharedTripThreadEntry[];
  }>({ loaded: false, entries: [] });
  const [assistantChatDoc, setAssistantChatDoc] = useState<{
    exists: boolean;
    messages: TripChatMessage[];
  }>({ exists: false, messages: [] });
  const [localChatTrip, setLocalChatTrip] = useState<TripChatMessage[]>([]);

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
    if (!useFirestore || !user?.email?.trim() || !tripId) {
      setAssistantChatDoc({ exists: false, messages: [] });
      return () => {};
    }
    const email = user.email!.trim();
    return subscribeTripAssistantChat(email, tripId, email, setAssistantChatDoc);
  }, [useFirestore, user?.email, tripId]);

  useEffect(() => {
    if (!useFirestore || !user?.email?.trim()) {
      setImmutableQueue({ loaded: false, entries: [] });
      return () => {};
    }
    const email = user.email!.trim();
    return subscribeImmutableMemoryQueueEntries(
      email,
      (rows) => setImmutableQueue({ loaded: true, entries: rows }),
      () => setImmutableQueue({ loaded: true, entries: [] })
    );
  }, [useFirestore, user?.email]);

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

  useEffect(() => {
    if (!tripId) {
      setLocalChatTrip([]);
      return;
    }
    setLocalChatTrip(loadTripChatLocal(tripId));
  }, [tripId]);

  const tripChatMessages = useMemo<TripChatMessage[]>(() => {
    if (!tripId) return [];
    if (sharedThread.loaded) {
      const allForTrip = sharedThread.entries.filter((e) => e.tripId === tripId);
      if (allForTrip.length > 0) {
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
      }
    }
    if (assistantChatDoc.exists) return assistantChatDoc.messages;
    const fromLegacy = messagesForTrip(chatMemory, tripId);
    if (fromLegacy.length > 0) return fromLegacy;
    return localChatTrip;
  }, [
    assistantChatDoc.exists,
    assistantChatDoc.messages,
    chatMemory,
    localChatTrip,
    sharedThread.loaded,
    sharedThread.entries,
    tripId,
  ]);

  const globalChatMessages = useMemo<TripChatMessage[]>(() => {
    if (!immutableQueue.loaded) return [];
    return immutableQueue.entries
      .filter((e) => e.active && e.tripId === "__global__")
      .slice(-10)
      .map((e) => ({
        tripId: e.tripId,
        from: e.from,
        content: e.content,
        timeStamp: new Date(e.createdAtMs).toISOString(),
        ...(e.memoryCompressed === true ? { memoryCompressed: true as const } : {}),
      }));
  }, [immutableQueue.loaded, immutableQueue.entries]);

  const canPersistMemory = Boolean(useFirestore && user?.email?.trim());

  return {
    user,
    profilePreferences,
    tripChatMessages,
    globalChatMessages,
    canPersistMemory,
  };
}
