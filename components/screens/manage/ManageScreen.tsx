"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setManageDraft, patchDraft } from "@/lib/store/tripSlice";
import { useTripData } from "@/lib/trip/useTripData";
import { subscribeUser } from "@/lib/usersFirestore";
import type { UserPreferences } from "@/lib/types/trip";
import { ManageTripWorkspace } from "@/components/manage/ManageTripWorkspace";
import { TripLoadStateScreen } from "@/components/screens/_shared/TripLoadStateScreen";

export function ManageScreen({ tripId }: { tripId: string }) {
  const { trip, loadState, persistTrip, canManage, useFirestore, saveError, user } =
    useTripData(tripId);
  const dispatch = useAppDispatch();
  const draft = useAppSelector((s) => s.trip.draft);
  const { t } = useI18n();
  const [profilePreferences, setProfilePreferences] = useState<UserPreferences | null>(null);

  useEffect(() => {
    if (trip) dispatch(setManageDraft(trip));
  }, [trip, dispatch]);

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
        <Link
          href={`/trip/${tripId}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium text-[var(--color-muted-foreground)] shadow-sm transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-foreground)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          <span>{t("shell.backToTrip")}</span>
        </Link>
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
      />
    </div>
  );
}
