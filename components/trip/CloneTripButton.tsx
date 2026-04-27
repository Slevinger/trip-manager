"use client";

import { useState } from "react";
import { useTripDocument } from "@/components/providers/TripDocumentProvider";
import { useI18n } from "@/components/providers/I18nProvider";
import { normalizeEmail } from "@/lib/tripAccess";

export function CloneTripButton() {
  const { trip, user } = useTripDocument();
  const { t } = useI18n();
  const [cloning, setCloning] = useState(false);

  async function cloneTrip() {
    const email = user?.email?.trim() ?? "";
    const emailLower = normalizeEmail(email);
    if (!trip || !user || !emailLower || cloning) return;

    setCloning(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/trips/${trip.id}/clone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        throw new Error(`clone_failed_${res.status}`);
      }
      const data = (await res.json()) as { tripId?: string };
      if (!data.tripId) throw new Error("clone_failed_missing_trip_id");
      window.location.href = `/trip/${data.tripId}`;
    } catch (error) {
      console.error("clone trip failed", error);
      setCloning(false);
      window.alert(t("share.cloneFailed"));
    }
  }

  return (
    <button
      type="button"
      disabled={!trip || cloning}
      onClick={() => void cloneTrip()}
      className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
    >
      {cloning ? t("share.cloning") : t("share.cloneTrip")}
    </button>
  );
}

