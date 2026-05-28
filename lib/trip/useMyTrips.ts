"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteCanonicalTrip,
  saveCanonicalTrip,
  sessionIsGoogleSignIn,
  subscribeMyCanonicalTrips,
} from "@/lib/canonicalTripsFirestore";
import { useFirebaseUser } from "@/lib/auth/useFirebaseUser";
import { getDb } from "@/lib/firebase";
import {
  deleteTrip as deleteLocalTrip,
  ensureSeedTrip,
  listTrips as listLocalTrips,
  putTrip as putLocalTrip,
} from "@/lib/tripLocalStore";
import type { Trip } from "@/lib/types/trip";

interface MyTripsState {
  trips: Trip[];
  loading: boolean;
  error: string | null;
  needsSignIn: boolean;
  needsGoogle: boolean;
  refresh: () => void;
  saveTrip: (trip: Trip) => Promise<void>;
  deleteTrip: (trip: Trip) => Promise<void>;
}

export function useMyTrips(): MyTripsState {
  const { user, ready, useFirestore } = useFirebaseUser();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [needsGoogle, setNeedsGoogle] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!ready) return;
    setError(null);

    if (!useFirestore) {
      ensureSeedTrip();
      setTrips(listLocalTrips());
      setLoading(false);
      setNeedsSignIn(false);
      setNeedsGoogle(false);
      return;
    }
    const authUser = user;
    if (!authUser?.uid) {
      setTrips([]);
      setLoading(false);
      setNeedsSignIn(true);
      setNeedsGoogle(false);
      return;
    }

    let cancelled = false;
    let unsub: (() => void) | undefined;
    setLoading(true);
    void (async () => {
      const google = await sessionIsGoogleSignIn(authUser);
      if (cancelled) return;
      if (!google) {
        setNeedsGoogle(true);
        setNeedsSignIn(false);
        setTrips([]);
        setLoading(false);
        return;
      }
      setNeedsGoogle(false);
      setNeedsSignIn(false);
      unsub = subscribeMyCanonicalTrips(
        authUser,
        (list) => {
          setTrips(list);
          setLoading(false);
        },
        (e) => {
          setError(e.message);
          setLoading(false);
        },
        0
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [ready, useFirestore, user?.uid, refreshKey]);

  async function saveTrip(trip: Trip): Promise<void> {
    setError(null);
    const db = getDb();
    if (useFirestore && db && user) {
      await saveCanonicalTrip(db, trip, user);
      return;
    }
    putLocalTrip(trip);
    setTrips(listLocalTrips());
  }

  async function deleteTrip(trip: Trip): Promise<void> {
    setTrips((prev) => prev.filter((t) => t.id !== trip.id));
    const db = getDb();
    if (useFirestore && db && user) {
      await deleteCanonicalTrip(db, trip.id, user);
      refresh();
      return;
    }
    deleteLocalTrip(trip.id);
    setTrips(listLocalTrips());
  }

  return {
    trips,
    loading,
    error,
    needsSignIn,
    needsGoogle,
    refresh,
    saveTrip,
    deleteTrip,
  };
}
