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

/**
 * Subscribes to a canonical trip (Firestore) or falls back to the local store.
 * Mirrors the contract of the legacy `TripDetail` component but exposes a tiny
 * hook so every screen in the new IA shares one data path.
 */
export function useTripData(tripId: string): UseTripDataResult {
  const dispatch = useAppDispatch();
  const trip = useAppSelector((s) => s.trip.trip);
  const [loadState, setLoadState] = useState<TripLoadState>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const useFirestore = Boolean(getDb() && getMissingFirebasePublicEnv().length === 0);

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
        setLoadState("missing");
        return;
      }
      dispatch({ type: setTripAction.type, payload: local, meta: { history: "skip" } });
      setLoadState("ok");
      return;
    }

    let unsubTrip: (() => void) | undefined;
    let cancelled = false;
    const unsubAuth = onAuthStateChanged(auth!, (u) => {
      void (async () => {
        setUser(u);
        setCanManage(false);
        setIsOwner(false);
        unsubTrip?.();
        unsubTrip = undefined;
        if (cancelled) return;
        if (!u) {
          dispatch({ type: setTripAction.type, payload: null, meta: { history: "skip" } });
          setLoadState("needs_auth");
          return;
        }
        const google = await sessionIsGoogleSignIn(u);
        if (cancelled) return;
        if (!google) {
          dispatch({ type: setTripAction.type, payload: null, meta: { history: "skip" } });
          setLoadState("needs_google");
          return;
        }
        unsubTrip = subscribeCanonicalTrip(
          db,
          tripId,
          u,
          (t, access) => {
            if (!t) {
              dispatch({ type: setTripAction.type, payload: null, meta: { history: "skip" } });
              setCanManage(false);
              setIsOwner(false);
              setLoadState("missing");
              return;
            }
            dispatch({ type: setTripAction.type, payload: t, meta: { history: "skip" } });
            setCanManage(access?.canManageFirestore ?? false);
            setIsOwner(access?.isOwner ?? false);
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
              setLoadState("access_denied");
              return;
            }
            setLoadState("missing");
          }
        );
      })();
    });

    return () => {
      cancelled = true;
      unsubTrip?.();
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
    canManage: canManage || !useFirestore,
    isOwner: isOwner || !useFirestore,
    saveError,
    persistTrip,
  };
}
