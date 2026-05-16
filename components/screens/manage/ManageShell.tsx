"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { usePathname } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { patchDraft, redo, setManageDraft, undo } from "@/lib/store/tripSlice";
import { clearManageDraftLocal } from "@/lib/trip/manageDraftLocalCache";
import { useTripData } from "@/lib/trip/useTripData";
import { subscribeUser } from "@/lib/usersFirestore";
import type { Trip, UserPreferences } from "@/lib/types/trip";
import { ManageTripWorkspace } from "@/components/manage/ManageTripWorkspace";
import { TripLoadStateScreen } from "@/components/screens/_shared/TripLoadStateScreen";

// ---------------------------------------------------------------------------
// Dirty-check helpers
// ---------------------------------------------------------------------------

const MANAGE_DIRTY_STRIP_ROOT = new Set(["recommendations", "recommendationVotes", "liveLocations"]);

function sortKeysDeep(node: unknown): unknown {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(sortKeysDeep);
  const o = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) out[k] = sortKeysDeep(o[k]);
  return out;
}

function stripVolatile(node: unknown, isRoot: boolean): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach((i) => stripVolatile(i, false)); return; }
  const o = node as Record<string, unknown>;
  for (const k of [...Object.keys(o)]) {
    if (k === "updatedAt" || k === "createdAt") { delete o[k]; continue; }
    if (isRoot && MANAGE_DIRTY_STRIP_ROOT.has(k)) { delete o[k]; continue; }
    stripVolatile(o[k], false);
  }
}

function dirtyEssence(trip: Trip): string {
  const clone = JSON.parse(JSON.stringify(trip)) as Record<string, unknown>;
  stripVolatile(clone, true);
  return JSON.stringify(sortKeysDeep(clone));
}

// ---------------------------------------------------------------------------
// Section resolver
// ---------------------------------------------------------------------------

type ManageSection = "logistics" | "itinerary" | "people";

function sectionFromPathname(pathname: string): ManageSection {
  if (pathname.includes("/manage/itinerary")) return "itinerary";
  if (pathname.includes("/manage/people")) return "people";
  return "logistics";
}

// ---------------------------------------------------------------------------
// Core content — Redux draft, keyboard shortcuts, workspace render
// ---------------------------------------------------------------------------

function ManageContent({
  trip,
  tripId,
  persistTrip,
  canManage,
  useFirestore,
  saveError,
  user,
  section,
}: {
  trip: Trip;
  tripId: string;
  persistTrip: (next: Trip) => Promise<void>;
  canManage: boolean;
  useFirestore: boolean;
  saveError: string | null;
  user: User | null;
  section: ManageSection;
}) {
  const dispatch = useAppDispatch();
  const draft = useAppSelector((s) => s.trip.draft);
  const pastLen = useAppSelector((s) => s.trip.past.length);
  const futureLen = useAppSelector((s) => s.trip.future.length);
  const [profilePreferences, setProfilePreferences] = useState<UserPreferences | null>(null);
  const bootstrapped = useRef(false);

  const dirty = useAppSelector((s) => {
    const d = s.trip.draft;
    const loaded = s.trip.trip;
    if (!d || !loaded || loaded === d) return false;
    return dirtyEssence(loaded) !== dirtyEssence(d);
  });

  useEffect(() => { bootstrapped.current = false; }, [tripId]);

  useEffect(() => {
    if (!trip || trip.id !== tripId || bootstrapped.current) return;
    bootstrapped.current = true;
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
    const isEditable = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      if (t.isContentEditable) return true;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return Boolean(t.closest("input,textarea,select,[contenteditable=true]"));
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || isEditable(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && e.shiftKey && futureLen > 0) { e.preventDefault(); dispatch(redo()); }
      else if (k === "z" && pastLen > 0) { e.preventDefault(); dispatch(undo()); }
      else if (k === "y" && e.ctrlKey && !e.metaKey && futureLen > 0) { e.preventDefault(); dispatch(redo()); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, pastLen, futureLen]);

  useEffect(() => {
    if (!useFirestore || !user?.email?.trim()) { setProfilePreferences(null); return; }
    return subscribeUser(user.email, (u) => setProfilePreferences(u?.preferences ?? null));
  }, [useFirestore, user?.email]);

  if (!draft) return null;

  return (
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
  );
}

// ---------------------------------------------------------------------------
// Shell — mounts once for all /manage/* routes via layout.tsx
// ---------------------------------------------------------------------------

export function ManageShell({ tripId }: { tripId: string }) {
  const pathname = usePathname() ?? "";
  const { trip, loadState, persistTrip, canManage, useFirestore, saveError, user } =
    useTripData(tripId);
  const section = sectionFromPathname(pathname);

  return (
    <>
      {loadState !== "ok" || !trip ? (
        <TripLoadStateScreen state={loadState} />
      ) : (
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 lg:px-8">
          <ManageContent
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
      )}
    </>
  );
}
