"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "firebase/auth";
import { getDb } from "@/lib/firebase";
import {
  restoreTripFirebaseSession,
  startGoogleSignInForTrip,
} from "@/lib/tripAuth";
import { ensureTripAccessForUser, type TripMember, normalizeEmail } from "@/lib/tripAccess";
import type { Trip, TripStep } from "@/lib/types/trip";
import {
  cancelPendingTripSave,
  mergeTrip,
  rememberTripWriter,
  rememberTripSnapshot,
  saveTrip,
  subscribeToTrip,
  updateTrip,
} from "@/lib/trips";
import { resolveAutoActiveStepId } from "@/lib/timeline/autoCurrentStep";
import { defaultTrip } from "@/lib/tripDefaults";

type TripDocumentContextValue = {
  tripId: string;
  trip: Trip | null;
  user: User | null;
  member: TripMember | null;
  /** Show “Continue with Google” (OAuth redirect must start from a click, not `useEffect`). */
  authNeedsGoogleClick: boolean;
  signInWithGoogle: () => Promise<void>;
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
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<TripMember | null>(null);
  const [authNeedsGoogleClick, setAuthNeedsGoogleClick] = useState(false);
  const [authSessionNonce, setAuthSessionNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const signInWithGoogle = useCallback(async () => {
    try {
      setError(null);
      const mode = await startGoogleSignInForTrip(tripId);
      if (mode === "popup") {
        setAuthNeedsGoogleClick(false);
        setAuthSessionNonce((n) => n + 1);
      }
    } catch (e) {
      setAuthNeedsGoogleClick(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [tripId]);

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
        setLoading(true);
        setAuthNeedsGoogleClick(false);
        if (!getDb()) {
          setTrip(null);
          setError("firebase");
          setLoading(false);
          return;
        }

        const authStatus = await restoreTripFirebaseSession(tripId);
        if (authStatus.status === "needs_google_sign_in") {
          setUser(null);
          setMember(null);
          setError(null);
          setAuthNeedsGoogleClick(true);
          setLoading(false);
          return;
        }
        const currentUser = authStatus.user;
        setUser(currentUser);

        const access = await ensureTripAccessForUser(tripId, currentUser);
        if (access.accessDenied || !access.member) {
          setMember(null);
          setTrip(null);
          setError("ACCESS_DENIED");
          setLoading(false);
          return;
        }
        const accessMember = access.member;
        setMember(accessMember);
        rememberTripWriter(tripId, {
          uid: accessMember.uid,
          email: accessMember.email,
          emailLower: accessMember.emailLower,
        });

        unsub = subscribeToTrip(tripId, (remote, err) => {
          if (err) {
            setTrip(null);
            setError(err.message);
            setLoading(false);
            return;
          }
          if (!remote) {
            if (access.shouldBootstrapLocalTrip) {
              const localBootstrap = {
                ...defaultTrip(tripId),
                ownerUid: currentUser.uid,
                ownerEmail: accessMember.email,
                ownerEmailLower: normalizeEmail(accessMember.email),
              };
              setTrip(localBootstrap);
              rememberTripSnapshot(localBootstrap);
              setError(null);
            } else {
              setTrip(null);
            }
            setLoading(false);
            return;
          }
          setTrip(remote);
          setLoading(false);
          setError(null);
        });
      } catch (e) {
        setAuthNeedsGoogleClick(false);
        setUser(null);
        setMember(null);
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();

    return () => {
      if (unsub) unsub();
      cancelPendingTripSave(tripId);
      rememberTripWriter(tripId, null);
    };
  }, [tripId, authSessionNonce]);

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
  }, [trip?.autoCurrentByDate, trip?.steps, trip?.tripStartDate, trip?.tripStartTime]);

  const value = useMemo(
    () => ({
      tripId,
      trip,
      user,
      member,
      authNeedsGoogleClick,
      signInWithGoogle,
      loading,
      error,
      persist,
      persistPatch,
      persistUpdate,
      replaceSteps,
    }),
    [
      tripId,
      trip,
      user,
      member,
      authNeedsGoogleClick,
      signInWithGoogle,
      loading,
      error,
      persist,
      persistPatch,
      persistUpdate,
      replaceSteps,
    ]
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
