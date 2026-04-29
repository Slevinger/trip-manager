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
  rememberTripSnapshot,
  subscribeToTrip,
} from "@/lib/trips";
import { resolveAutoActiveStepId } from "@/lib/timeline/autoCurrentStep";
import { defaultTrip } from "@/lib/tripDefaults";

const TRIP_LOCAL_SNAPSHOT_PREFIX = "trip-doc-snapshot:";
const TRIP_LOCAL_SNAPSHOT_VERSION = 1;
const UNSAVED_EXIT_WARNING = "You have unsaved trip changes. Leave without saving?";
const DISABLE_TRIP_LOCAL_SNAPSHOT =
  process.env.NEXT_PUBLIC_DISABLE_TRIP_LOCAL_SNAPSHOT === "true";

type TripLocalSnapshot = {
  v: number;
  savedAt: string;
  hasUnsavedChanges: boolean;
  trip: Trip;
};

function tripSnapshotKey(tripId: string): string {
  return `${TRIP_LOCAL_SNAPSHOT_PREFIX}${tripId}`;
}

function readTripLocalSnapshot(tripId: string): TripLocalSnapshot | null {
  if (DISABLE_TRIP_LOCAL_SNAPSHOT) return null;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(tripSnapshotKey(tripId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TripLocalSnapshot;
    if (
      !parsed ||
      parsed.v !== TRIP_LOCAL_SNAPSHOT_VERSION ||
      !parsed.trip ||
      typeof parsed.trip !== "object"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeTripLocalSnapshot(tripId: string, trip: Trip, hasUnsavedChanges: boolean): void {
  if (DISABLE_TRIP_LOCAL_SNAPSHOT) return;
  if (typeof window === "undefined") return;
  try {
    const payload: TripLocalSnapshot = {
      v: TRIP_LOCAL_SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      hasUnsavedChanges,
      trip,
    };
    window.localStorage.setItem(tripSnapshotKey(tripId), JSON.stringify(payload));
  } catch {
    /* ignore localStorage quota / privacy mode errors */
  }
}

function toMs(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shouldPreferLocalSnapshot(local: TripLocalSnapshot, remote: Trip): boolean {
  if (!local.hasUnsavedChanges) return false;
  return toMs(local.savedAt) >= toMs(remote.updatedAt);
}

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
  member: null;
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
  const [member, setMember] = useState<null>(null);
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
      writeTripLocalSnapshot(tripId, normalized, true);
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
      writeTripLocalSnapshot(tripId, next, true);
    },
    [dispatch, store, tripId]
  );

  const persistUpdate = useCallback(
    (patch: Partial<Trip>) => {
      const next = mergeLatestTrip(tripId, patch);
      dispatch(userPersisted(next));
      rememberTripSnapshot(next);
      writeTripLocalSnapshot(tripId, next, true);
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
    if (restored) {
      rememberTripSnapshot(restored);
      writeTripLocalSnapshot(tripId, restored, true);
    }
    return true;
  }, [dispatch, store, tripId]);

  const saveNow = useCallback(async () => {
    const t = store.getState().tripDocument.trip;
    if (!t) return;
    const normalized = { ...t, id: tripId };
    await flushTripSaveNow(normalized);
    dispatch(markTripSynced());
    writeTripLocalSnapshot(tripId, normalized, false);
  }, [dispatch, store, tripId]);

  useEffect(() => {
    const writeSnapshot = () => {
      try {
        const state = store.getState().tripDocument;
        if (!state.trip) {
          return;
        }
        writeTripLocalSnapshot(tripId, state.trip, state.hasUnsavedChanges);
      } catch {
        /* ignore localStorage quota / privacy mode errors */
      }
    };
    writeSnapshot();
    const unsubscribe = store.subscribe(writeSnapshot);
    return () => unsubscribe();
  }, [store, tripId]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!store.getState().tripDocument.hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = UNSAVED_EXIT_WARNING;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [store]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        if (cancelled) return;
        setLoading(true);
        dispatch(resetTripDocument());
        if (!getDb()) {
          if (cancelled) return;
          dispatch(resetTripDocument());
          setError("firebase");
          setLoading(false);
          return;
        }
        const authStatus = await restoreTripFirebaseSession(tripId);
        if (cancelled) return;
        if (authStatus.status === "needs_google_sign_in") {
          setUser(null);
          setAuthNeedsGoogleClick(true);
          dispatch(resetTripDocument());
          setError("AUTH_REQUIRED");
          setLoading(false);
          return;
        }
        setUser(authStatus.user);
        setMember(null);

        let local = readTripLocalSnapshot(tripId);
        if (local?.trip) {
          if (local.hasUnsavedChanges) {
            dispatch(userPersisted(local.trip));
          } else {
            dispatch(remoteSnapshotApplied(local.trip));
          }
          rememberTripSnapshot(local.trip);
          writeTripLocalSnapshot(tripId, local.trip, local.hasUnsavedChanges);
        }

        const localUnsub = subscribeToTrip(tripId, (remote, err) => {
          if (cancelled) return;
          if (err) {
            dispatch(resetTripDocument());
            setError(err.message);
            setLoading(false);
            return;
          }
          if (!remote) {
            const localBootstrap = defaultTrip(tripId);
            dispatch(userPersisted(localBootstrap));
            rememberTripSnapshot(localBootstrap);
            writeTripLocalSnapshot(tripId, localBootstrap, true);
            setError(null);
            setLoading(false);
            return;
          }
          local = readTripLocalSnapshot(tripId);
          if (local?.trip && shouldPreferLocalSnapshot(local, remote)) {
            dispatch(userPersisted(local.trip));
            rememberTripSnapshot(local.trip);
            writeTripLocalSnapshot(tripId, local.trip, true);
            setLoading(false);
            setError(null);
            return;
          }
          dispatch(remoteSnapshotApplied(remote));
          writeTripLocalSnapshot(tripId, remote, false);
          setLoading(false);
          setError(null);
        });
        if (cancelled) {
          localUnsub();
          return;
        }
        unsub = localUnsub;
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
      cancelled = true;
      if (unsub) unsub();
      cancelPendingTripSave(tripId);
    };
  }, [tripId, dispatch, authSessionNonce]);

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
