"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { patchDraft, redo, setManageDraft, undo } from "@/lib/store/tripSlice";
import { clearManageDraftLocal } from "@/lib/trip/manageDraftLocalCache";
import { useTripData } from "@/lib/trip/useTripData";
import { subscribeUser } from "@/lib/usersFirestore";
import type { Trip, UserPreferences } from "@/lib/types/trip";
import { ManageTripWorkspace } from "@/components/manage/ManageTripWorkspace";
import { TripLoadStateScreen } from "@/components/screens/_shared/TripLoadStateScreen";
import { TripTopNav } from "@/components/screens/_shared/TripTopNav";

/** Root keys ignored for dirty (assistant / live telemetry); nested `updatedAt`/`createdAt` stripped everywhere. */
const MANAGE_DIRTY_STRIP_ROOT = new Set([
  "recommendations",
  "recommendationVotes",
  "liveLocations",
]);

function sortKeysDeep(node: unknown): unknown {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(sortKeysDeep);
  const o = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    out[k] = sortKeysDeep(o[k]);
  }
  return out;
}

function stripManageDirtyVolatile(node: unknown, isRoot: boolean): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) stripManageDirtyVolatile(item, false);
    return;
  }
  const o = node as Record<string, unknown>;
  for (const k of [...Object.keys(o)]) {
    if (k === "updatedAt" || k === "createdAt") {
      delete o[k];
      continue;
    }
    if (isRoot && MANAGE_DIRTY_STRIP_ROOT.has(k)) {
      delete o[k];
      continue;
    }
    stripManageDirtyVolatile(o[k], false);
  }
}

/** Canonical JSON for dirty: volatile timestamps + ignored roots removed, keys sorted. */
function manageDirtyEssence(trip: Trip): string {
  const clone = JSON.parse(JSON.stringify(trip)) as Record<string, unknown>;
  stripManageDirtyVolatile(clone, true);
  return JSON.stringify(sortKeysDeep(clone));
}

/**
 * Core manage content — all Redux draft logic, keyboard shortcuts, form.
 * Rendered directly by TripScreen (standalone=false) or wrapped by ManageScreen.
 */
export function ManageTabContent({
  trip,
  tripId,
  persistTrip,
  canManage,
  useFirestore,
  saveError,
  user,
  section = "logistics",
}: {
  trip: Trip;
  tripId: string;
  persistTrip: (next: Trip) => Promise<void>;
  canManage: boolean;
  useFirestore: boolean;
  saveError: string | null;
  user: User | null;
  section?: "logistics" | "itinerary" | "people";
}) {
  const dispatch = useAppDispatch();
  const draft = useAppSelector((s) => s.trip.draft);
  const pastLen = useAppSelector((s) => s.trip.past.length);
  const futureLen = useAppSelector((s) => s.trip.future.length);
  const [profilePreferences, setProfilePreferences] = useState<UserPreferences | null>(null);
  const manageDraftBootstrapped = useRef(false);

  const dirty = useAppSelector((s) => {
    const d = s.trip.draft;
    const loaded = s.trip.trip;
    if (!d || !loaded) return false;
    if (loaded === d) return false;
    return manageDirtyEssence(loaded) !== manageDirtyEssence(d);
  });

  useEffect(() => {
    manageDraftBootstrapped.current = false;
  }, [tripId]);

  useEffect(() => {
    if (!trip || trip.id !== tripId || manageDraftBootstrapped.current) return;
    manageDraftBootstrapped.current = true;
    dispatch(setManageDraft(trip));
  }, [trip, tripId, dispatch]);

  useEffect(() => {
    if (!trip?.id || trip.id !== tripId) return;
    if (!dirty) {
      clearManageDraftLocal(tripId);
      dispatch(setManageDraft(trip));
    }
  }, [trip, tripId, dirty, dispatch]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return Boolean(target.closest("input, textarea, select, [contenteditable=true]"));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (isEditableTarget(e.target)) return;

      const key = e.key.toLowerCase();
      if (key === "z" && e.shiftKey) {
        if (futureLen > 0) {
          e.preventDefault();
          dispatch(redo());
        }
        return;
      }
      if (key === "z") {
        if (pastLen > 0) {
          e.preventDefault();
          dispatch(undo());
        }
        return;
      }
      if (key === "y" && e.ctrlKey && !e.metaKey) {
        if (futureLen > 0) {
          e.preventDefault();
          dispatch(redo());
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, pastLen, futureLen]);

  useEffect(() => {
    if (!useFirestore || !user?.email?.trim()) {
      setProfilePreferences(null);
      return () => {};
    }
    return subscribeUser(user.email, (u) => setProfilePreferences(u?.preferences ?? null));
  }, [useFirestore, user?.email]);

  if (!draft) return null;

  return (
    <>
      <ManageTripWorkspace
        trip={draft}
        onTripChange={(next) => dispatch(patchDraft(next))}
        persistTrip={persistTrip}
        canUploadTripFiles={Boolean(useFirestore && user?.email)}
        saveTarget={useFirestore ? "Firestore" : "localStorage"}
        saveDisabled={!canManage}
        saveError={saveError}
        user={user}
        profilePreferences={profilePreferences}
        dirty={dirty}
        canUndo={pastLen > 0}
        canRedo={futureLen > 0}
        onUndo={() => dispatch(undo())}
        onRedo={() => dispatch(redo())}
        section={section}
      />
    </>
  );
}

export function ManageScreen({ tripId, section = "logistics" }: { tripId: string; section?: "logistics" | "itinerary" | "people" }) {
  const { trip, loadState, persistTrip, canManage, useFirestore, saveError, user } =
    useTripData(tripId);

  if (loadState !== "ok" || !trip) {
    return <TripLoadStateScreen state={loadState} />;
  }

  return (
    <>
      <TripTopNav tripId={tripId} />
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 lg:px-8">
        <ManageTabContent
          trip={trip}
          tripId={tripId}
          persistTrip={persistTrip}
          canManage={canManage}
          useFirestore={useFirestore}
          saveError={saveError}
          user={user}
          section={section}
        />
      </div>
    </>
  );
}
