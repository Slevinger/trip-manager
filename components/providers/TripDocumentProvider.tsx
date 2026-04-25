"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { ensureTripFirebaseAuth } from "@/lib/tripAuth";
import type { Trip, TripStep } from "@/lib/types/trip";
import {
  cancelPendingTripSave,
  createTrip,
  getTripRef,
  mergeTrip,
  rememberTripSnapshot,
  saveTrip,
  subscribeToTrip,
  updateTrip,
} from "@/lib/trips";
import { resolveAutoActiveStepId } from "@/lib/timeline/autoCurrentStep";

type TripDocumentContextValue = {
  tripId: string;
  trip: Trip | null;
  loading: boolean;
  error: string | null;
  /** Replace entire trip (optimistic + debounced save). */
  persist: (next: Trip) => void;
  /** Merge partial trip fields (optimistic + debounced save). */
  persistPatch: (patch: Partial<Trip>) => void;
  /** Shallow merge using lib helper against latest known snapshot. */
  persistUpdate: (patch: Partial<Trip>) => Trip | null;
  replaceSteps: (steps: TripStep[]) => void;
};

const TripDocumentContext = createContext<TripDocumentContextValue | null>(
  null
);

function applyAutoStatuses(trip: Trip, now: Date): Trip {
  const activeId = resolveAutoActiveStepId(trip, now);
  if (!activeId) return trip;
  const steps = trip.steps.map((s) => {
    if (s.id === activeId) return { ...s, status: "active" as const };
    if (s.status === "active") return { ...s, status: "todo" as const };
    return s;
  });
  return { ...trip, steps };
}

export function TripDocumentProvider({
  tripId,
  children,
}: {
  tripId: string;
  children: React.ReactNode;
}) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const persist = useCallback((next: Trip) => {
    const normalized = { ...next, id: tripId };
    setTrip(normalized);
    rememberTripSnapshot(normalized);
    saveTrip(normalized);
  }, [tripId]);

  const persistPatch = useCallback(
    (patch: Partial<Trip>) => {
      setTrip((prev) => {
        if (!prev) return prev;
        const next = mergeTrip(prev, patch);
        rememberTripSnapshot(next);
        saveTrip(next);
        return next;
      });
    },
    []
  );

  const persistUpdate = useCallback(
    (patch: Partial<Trip>) => {
      const next = updateTrip(tripId, patch);
      setTrip(next);
      return next;
    },
    [tripId]
  );

  const replaceSteps = useCallback((steps: TripStep[]) => {
    persistPatch({ steps });
  }, [persistPatch]);

  useEffect(() => {
    let unsub: (() => void) | undefined;

    (async () => {
      try {
        if (!getDb()) {
          setTrip(null);
          setError("firebase");
          setLoading(false);
          return;
        }

        const authStatus = await ensureTripFirebaseAuth(tripId);
        if (authStatus === "admin_missing") {
          setTrip(null);
          setError("ADMIN_NOT_CONFIGURED");
          setLoading(false);
          return;
        }

        const ref = getTripRef(tripId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await createTrip(tripId);
        }
        unsub = subscribeToTrip(tripId, (remote, err) => {
          if (err) {
            setTrip(null);
            setError(err.message);
            setLoading(false);
            return;
          }
          if (!remote) {
            setTrip(null);
            setLoading(false);
            return;
          }
          setTrip(remote);
          setLoading(false);
          setError(null);
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();

    return () => {
      if (unsub) unsub();
      cancelPendingTripSave(tripId);
    };
  }, [tripId]);

  useEffect(() => {
    if (!trip?.autoCurrentByDate) return;
    const tick = () => {
      setTrip((prev) => {
        if (!prev?.autoCurrentByDate) return prev;
        const candidate = applyAutoStatuses(prev, new Date());
        const same =
          JSON.stringify(candidate.steps.map((s) => [s.id, s.status])) ===
          JSON.stringify(prev.steps.map((s) => [s.id, s.status]));
        if (same) return prev;
        rememberTripSnapshot(candidate);
        saveTrip(candidate);
        return candidate;
      });
    };
    const id = window.setInterval(tick, 60_000);
    tick();
    return () => window.clearInterval(id);
  }, [trip?.autoCurrentByDate, trip?.steps, trip?.tripStart]);

  const value = useMemo(
    () => ({
      tripId,
      trip,
      loading,
      error,
      persist,
      persistPatch,
      persistUpdate,
      replaceSteps,
    }),
    [tripId, trip, loading, error, persist, persistPatch, persistUpdate, replaceSteps]
  );

  return (
    <TripDocumentContext.Provider value={value}>
      {children}
    </TripDocumentContext.Provider>
  );
}

export function useTripDocument(): TripDocumentContextValue {
  const ctx = useContext(TripDocumentContext);
  if (!ctx) throw new Error("useTripDocument must be used within TripDocumentProvider");
  return ctx;
}

export function useTripDocumentSafe(): TripDocumentContextValue | null {
  return useContext(TripDocumentContext);
}
