"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { patchDraft, redo, setManageDraft, undo } from "@/lib/store/tripSlice";
import { useTripData } from "@/lib/trip/useTripData";
import { subscribeUser } from "@/lib/usersFirestore";
import type { UserPreferences } from "@/lib/types/trip";
import { ManageTripWorkspace } from "@/components/manage/ManageTripWorkspace";
import { TripLoadStateScreen } from "@/components/screens/_shared/TripLoadStateScreen";
import { TripBackToTripLink } from "@/components/screens/_shared/TripSubpageBackLink";

export function ManageScreen({ tripId }: { tripId: string }) {
  const { trip, loadState, persistTrip, canManage, useFirestore, saveError, user } =
    useTripData(tripId);
  const dispatch = useAppDispatch();
  const draft = useAppSelector((s) => s.trip.draft);
  const pastLen = useAppSelector((s) => s.trip.past.length);
  const futureLen = useAppSelector((s) => s.trip.future.length);
  const { t } = useI18n();
  const [profilePreferences, setProfilePreferences] = useState<UserPreferences | null>(null);

  useEffect(() => {
    if (trip) dispatch(setManageDraft(trip));
  }, [trip, dispatch]);

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

  const dirty = useMemo(() => {
    if (!draft || !trip) return false;
    return JSON.stringify(draft) !== JSON.stringify(trip);
  }, [draft, trip]);

  if (loadState !== "ok" || !trip || !draft) {
    return <TripLoadStateScreen state={loadState} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 lg:px-8">
      <header className="space-y-2">
        <TripBackToTripLink tripId={tripId} />
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-brand)]">
          {trip.title}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--color-foreground)]">
          {t("shell.manage")}
        </h1>
      </header>

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
      />
    </div>
  );
}
