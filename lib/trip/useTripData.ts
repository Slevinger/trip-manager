"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  ensureCanonicalTripListsMyUid,
  saveCanonicalTrip,
  sessionIsGoogleSignIn,
  subscribeCanonicalTrip,
} from "@/lib/canonicalTripsFirestore";
import { getClientAuth, getDb, getMissingFirebasePublicEnv } from "@/lib/firebase";
import { normalizeTripForPersist } from "@/lib/canonicalStepBuilders";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  setActiveTripId,
  setFirestoreTripAccess,
  setManageDraft as setManageDraftAction,
  setTrip as setTripAction,
} from "@/lib/store/tripSlice";
import { getTrip, putTrip } from "@/lib/tripLocalStore";
import type { Trip } from "@/lib/types/trip";

export type TripLoadState =
  | "loading"
  | "ok"
  | "missing"
  | "needs_auth"
  | "needs_google"
  | "access_denied";

export interface UseTripDataResult {
  trip: Trip | null;
  loadState: TripLoadState;
  user: User | null;
  useFirestore: boolean;
  canManage: boolean;
  isOwner: boolean;
  saveError: string | null;
  persistTrip: (next: Trip) => Promise<void>;
}

type SharedDoc = { refCount: number; unsub: () => void };

/** One `onSnapshot` per trip doc + uid — multiple `useTripData` hooks share it (avoids Firestore SDK watch bugs). */
const tripDocSharedListeners = new Map<string, SharedDoc>();

function sharedTripDocKey(tripId: string, uid: string): string {
  return `${tripId.trim()}::${uid.trim()}`;
}

function acquireTripDocListener(key: string, subscribe: () => () => void): () => void {
  let entry = tripDocSharedListeners.get(key);
  if (!entry) {
    const unsub = subscribe();
    entry = { refCount: 0, unsub };
    tripDocSharedListeners.set(key, entry);
  }
  entry.refCount += 1;
  return () => {
    const e = tripDocSharedListeners.get(key);
    if (!e) return;
    e.refCount -= 1;
    if (e.refCount <= 0) {
      e.unsub();
      tripDocSharedListeners.delete(key);
    }
  };
}

/**
 * Subscribes to a canonical trip (Firestore) or falls back to the local store.
 * Firestore path uses a **ref-counted shared** `onSnapshot` per `tripId`+user so nested
 * `useTripData(tripId)` + SmartDock do not attach duplicate listeners (fixes internal
 * assertion failures in the Firestore watch client).
 */
export function useTripData(tripId: string): UseTripDataResult {
  const dispatch = useAppDispatch();
  const trip = useAppSelector((s) => s.trip.trip);
  const firestoreTripAccess = useAppSelector((s) => s.trip.firestoreTripAccess);
  const [loadState, setLoadState] = useState<TripLoadState>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const useFirestore = Boolean(getDb() && getMissingFirebasePublicEnv().length === 0);
  const canManageFirestore = firestoreTripAccess?.canManageFirestore ?? false;
  const isOwnerFirestore = firestoreTripAccess?.isOwner ?? false;

  useEffect(() => {
    dispatch(setActiveTripId(tripId));
  }, [dispatch, tripId]);

  useEffect(() => {
    setLoadState("loading");
    setSaveError(null);

    const db = getDb();
    const auth = getClientAuth();
    const missing = getMissingFirebasePublicEnv();

    if (!db || missing.length > 0) {
      const local = getTrip(tripId);
      if (!local) {
        dispatch({ type: setTripAction.type, payload: null, meta: { history: "skip" } });
        dispatch({ type: setFirestoreTripAccess.type, payload: null, meta: { history: "skip" } });
        setLoadState("missing");
        return;
      }
      dispatch({ type: setTripAction.type, payload: local, meta: { history: "skip" } });
      dispatch({
        type: setFirestoreTripAccess.type,
        payload: { canManageFirestore: true, isOwner: true },
        meta: { history: "skip" },
      });
      setLoadState("ok");
      return;
    }

    let releaseTrip: (() => void) | undefined;
    let subscriptionGen = 0;
    let cancelled = false;

    const unsubAuth = onAuthStateChanged(auth!, (u) => {
      const gen = ++subscriptionGen;
      void (async () => {
        setUser(u);
        releaseTrip?.();
        releaseTrip = undefined;
        if (cancelled || gen !== subscriptionGen) return;
        if (!u) {
          dispatch({ type: setTripAction.type, payload: null, meta: { history: "skip" } });
          dispatch({ type: setFirestoreTripAccess.type, payload: null, meta: { history: "skip" } });
          setLoadState("needs_auth");
          return;
        }
        const google = await sessionIsGoogleSignIn(u);
        if (cancelled || gen !== subscriptionGen) return;
        if (!google) {
          dispatch({ type: setTripAction.type, payload: null, meta: { history: "skip" } });
          dispatch({ type: setFirestoreTripAccess.type, payload: null, meta: { history: "skip" } });
          setLoadState("needs_google");
          return;
        }

        const key = sharedTripDocKey(tripId, u.uid);
        releaseTrip = acquireTripDocListener(key, () =>
          subscribeCanonicalTrip(
            db,
            tripId,
            u,
            (t, access) => {
              if (!t) {
                dispatch({ type: setTripAction.type, payload: null, meta: { history: "skip" } });
                dispatch({ type: setFirestoreTripAccess.type, payload: null, meta: { history: "skip" } });
                setLoadState("missing");
                return;
              }
              dispatch({ type: setTripAction.type, payload: t, meta: { history: "skip" } });
              dispatch({
                type: setFirestoreTripAccess.type,
                payload: {
                  canManageFirestore: access?.canManageFirestore ?? false,
                  isOwner: access?.isOwner ?? false,
                },
                meta: { history: "skip" },
              });
              setLoadState("ok");
              void ensureCanonicalTripListsMyUid(db, tripId, u).catch(() => {});
            },
            (err) => {
              const code =
                typeof err === "object" && err !== null && "code" in err
                  ? String((err as { code?: string }).code)
                  : "";
              if (code.includes("permission-denied")) {
                dispatch({ type: setTripAction.type, payload: null, meta: { history: "skip" } });
                dispatch({ type: setFirestoreTripAccess.type, payload: null, meta: { history: "skip" } });
                setLoadState("access_denied");
                return;
              }
              setLoadState("missing");
            }
          )
        );
      })();
    });

    return () => {
      cancelled = true;
      subscriptionGen += 1;
      releaseTrip?.();
      unsubAuth();
    };
  }, [dispatch, tripId]);

  async function persistTrip(next: Trip): Promise<void> {
    setSaveError(null);
    try {
      const normalized = normalizeTripForPersist(next);
      const db = getDb();
      if (useFirestore && db && user) {
        await saveCanonicalTrip(db, normalized, user);
        dispatch({ type: setTripAction.type, payload: normalized, meta: { history: "skip" } });
        dispatch({
          type: setManageDraftAction.type,
          payload: normalized,
          meta: { history: "skip" },
        });
        return;
      }
      putTrip(normalized);
      const saved = getTrip(tripId) ?? normalized;
      dispatch({ type: setTripAction.type, payload: saved, meta: { history: "skip" } });
      dispatch({ type: setManageDraftAction.type, payload: saved, meta: { history: "skip" } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg);
      throw e;
    }
  }

  return {
    trip,
    loadState,
    user,
    useFirestore,
    canManage: canManageFirestore || !useFirestore,
    isOwner: isOwnerFirestore || !useFirestore,
    saveError,
    persistTrip,
  };
}
