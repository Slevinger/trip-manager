"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Provider } from "react-redux";
import type { User } from "firebase/auth";
import { getDb } from "@/lib/firebase";
import {
  restoreTripFirebaseSession,
  startGoogleSignInForTrip,
} from "@/lib/tripAuth";
import { ensureTripAccessForUser, type TripMember, normalizeEmail } from "@/lib/tripAccess";
import type { Trip, TripStep } from "@/lib/types/trip";
import {
  autoStatusApplied,
  markTripSynced,
  remoteSnapshotApplied,
  resetTripDocument,
  undoLastUserChange,
  userPersisted,
} from "@/lib/store/tripDocumentSlice";
import {
  makeTripDocumentStore,
  useTripDocumentDispatch,
  useTripDocumentSelector,
  useTripDocumentStore,
} from "@/lib/store/tripDocumentStore";
import type { TripChangeLogEntry } from "@/lib/store/tripChangeLog";
import {
  cancelPendingTripSave,
  flushTripSaveNow,
  mergeLatestTrip,
  mergeTrip,
  rememberTripWriter,
  rememberTripSnapshot,
  subscribeToTrip,
} from "@/lib/trips";
import { resolveAutoActiveStepId } from "@/lib/timeline/autoCurrentStep";
import { defaultTrip } from "@/lib/tripDefaults";

type TripDocumentContextValue = {
  tripId: string;
  trip: Trip | null;
  /** Append-only list of trip mutations (local + remote sync + auto status). */
  changeLog: TripChangeLogEntry[];
  /** Whether there is a local edit to undo (cleared after remote sync). */
  canUndo: boolean;
  /** Reverts the last local edit (Redux only). Use Save to persist. */
  undo: () => boolean;
  /** True when local edits are not yet written to Firestore. */
  hasUnsavedChanges: boolean;
  /** Write the current trip from the store to Firestore. */
  saveNow: () => Promise<void>;
  user: User | null;
  member: TripMember | null;
  /** Show “Continue with Google” (OAuth redirect must start from a click, not `useEffect`). */
  authNeedsGoogleClick: boolean;
  signInWithGoogle: () => Promise<void>;
  loading: boolean;
  error: string | null;
  /** Replace entire trip in Redux only; use Save to persist to Firestore. */
  persist: (next: Trip) => void;
  /** Merge partial trip fields in Redux only. */
  persistPatch: (patch: Partial<Trip>) => void;
  /** Merge against latest remembered trip in Redux only. */
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
  const store = useMemo(() => makeTripDocumentStore(), [tripId]);
  return (
    <Provider store={store}>
      <TripDocumentInner tripId={tripId}>{children}</TripDocumentInner>
    </Provider>
  );
}

function TripDocumentInner({
  tripId,
  children,
}: {
  tripId: string;
  children: React.ReactNode;
}) {
  const dispatch = useTripDocumentDispatch();
  const store = useTripDocumentStore();
  const trip = useTripDocumentSelector((s) => s.tripDocument.trip);
  const changeLog = useTripDocumentSelector((s) => s.tripDocument.changeLog);
  const canUndo = useTripDocumentSelector((s) => s.tripDocument.userUndoStack.length > 0);
  const hasUnsavedChanges = useTripDocumentSelector(
    (s) => s.tripDocument.hasUnsavedChanges
  );

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

  const persist = useCallback(
    (next: Trip) => {
      const normalized = { ...next, id: tripId };
      dispatch(userPersisted(normalized));
      rememberTripSnapshot(normalized);
    },
    [dispatch, tripId]
  );

  const persistPatch = useCallback(
    (patch: Partial<Trip>) => {
      const prev = store.getState().tripDocument.trip;
      if (!prev) return;
      const next = mergeTrip(prev, patch);
      dispatch(userPersisted(next));
      rememberTripSnapshot(next);
    },
    [dispatch, store]
  );

  const persistUpdate = useCallback(
    (patch: Partial<Trip>) => {
      const next = mergeLatestTrip(tripId, patch);
      dispatch(userPersisted(next));
      rememberTripSnapshot(next);
      return next;
    },
    [dispatch, tripId]
  );

  const replaceSteps = useCallback(
    (steps: TripStep[]) => {
      persistPatch({ steps });
    },
    [persistPatch]
  );

  const undo = useCallback(() => {
    const stackLen = store.getState().tripDocument.userUndoStack.length;
    if (stackLen === 0) return false;
    dispatch(undoLastUserChange());
    const restored = store.getState().tripDocument.trip;
    if (restored) rememberTripSnapshot(restored);
    return true;
  }, [dispatch, store]);

  const saveNow = useCallback(async () => {
    const t = store.getState().tripDocument.trip;
    if (!t) return;
    const normalized = { ...t, id: tripId };
    try {
      await flushTripSaveNow(normalized);
      dispatch(markTripSynced());
    } catch {
      /* keep hasUnsavedChanges true */
    }
  }, [dispatch, store, tripId]);

  useEffect(() => {
    let unsub: (() => void) | undefined;

    (async () => {
      try {
        setLoading(true);
        setAuthNeedsGoogleClick(false);
        dispatch(resetTripDocument());
        if (!getDb()) {
          dispatch(resetTripDocument());
          setError("firebase");
          setLoading(false);
          return;
        }

        const authStatus = await restoreTripFirebaseSession(tripId);
        if (authStatus.status === "needs_google_sign_in") {
          setUser(null);
          setMember(null);
          setError(null);
          dispatch(resetTripDocument());
          setAuthNeedsGoogleClick(true);
          setLoading(false);
          return;
        }
        const currentUser = authStatus.user;
        setUser(currentUser);

        const access = await ensureTripAccessForUser(tripId, currentUser);
        if (access.accessDenied || !access.member) {
          setMember(null);
          dispatch(resetTripDocument());
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
            dispatch(resetTripDocument());
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
              dispatch(userPersisted(localBootstrap));
              rememberTripSnapshot(localBootstrap);
              setError(null);
            } else {
              dispatch(resetTripDocument());
            }
            setLoading(false);
            return;
          }
          dispatch(remoteSnapshotApplied(remote));
          setLoading(false);
          setError(null);
        });
      } catch (e) {
        setAuthNeedsGoogleClick(false);
        setUser(null);
        setMember(null);
        dispatch(resetTripDocument());
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();

    return () => {
      if (unsub) unsub();
      cancelPendingTripSave(tripId);
      rememberTripWriter(tripId, null);
    };
  }, [tripId, authSessionNonce, dispatch]);

  useEffect(() => {
    if (!trip?.autoCurrentByDate) return;
    const tick = () => {
      const prev = store.getState().tripDocument.trip;
      if (!prev?.autoCurrentByDate) return;
      const candidate = applyAutoStatuses(prev, new Date());
      const same =
        JSON.stringify(candidate.steps.map((s: TripStep) => [s.id, s.status])) ===
        JSON.stringify(prev.steps.map((s: TripStep) => [s.id, s.status]));
      if (same) return;
      dispatch(autoStatusApplied(candidate));
      rememberTripSnapshot(candidate);
    };
    const id = window.setInterval(tick, 60_000);
    tick();
    return () => window.clearInterval(id);
  }, [
    dispatch,
    store,
    trip?.autoCurrentByDate,
    trip?.steps,
    trip?.tripStartDate,
    trip?.tripStartTime,
  ]);

  const value = useMemo(
    () => ({
      tripId,
      trip,
      changeLog,
      canUndo,
      undo,
      hasUnsavedChanges,
      saveNow,
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
      changeLog,
      canUndo,
      undo,
      hasUnsavedChanges,
      saveNow,
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
