"use client";

import { useState } from "react";
import { TripHeader } from "@/components/trip/TripHeader";
import { Tabs } from "@/components/trip/Tabs";
import { ViewTab } from "@/components/trip/ViewTab";
import { ManageTab } from "@/components/trip/ManageTab";
import {
  TripDocumentProvider,
  useTripDocument,
} from "@/components/providers/TripDocumentProvider";
import { useI18n } from "@/components/providers/I18nProvider";
import { getDb, getMissingFirebasePublicEnv } from "@/lib/firebase";

export function TripPage({ tripId }: { tripId: string }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"view" | "manage">("view");

  if (!getDb()) {
    const missingEnv = getMissingFirebasePublicEnv();
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
          {t("firebase.missing")}
        </p>
        {missingEnv.length > 0 ? (
          <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
            <p className="font-medium text-zinc-800 dark:text-zinc-100">
              {t("firebase.missingVars")}
            </p>
            <ul className="mt-2 list-inside list-disc font-mono text-xs text-zinc-600 dark:text-zinc-300">
              {missingEnv.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <TripDocumentProvider tripId={tripId}>
      <TripChrome tab={tab} onTab={setTab} />
    </TripDocumentProvider>
  );
}

function TripChrome({
  tab,
  onTab,
}: {
  tab: "view" | "manage";
  onTab: (next: "view" | "manage") => void;
}) {
  const { t } = useI18n();
  const { trip, loading, error } = useTripDocument();

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-zinc-500">
        {t("common.loading")}
      </main>
    );
  }

  if (error) {
    const message =
      error === "ADMIN_NOT_CONFIGURED"
        ? t("firebase.adminServiceAccount")
        : error === "firebase"
          ? t("firebase.missing")
          : error.includes("auth/configuration-not-found")
            ? t("firebase.authNotEnabled")
            : `${t("common.error")}: ${error}`;
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
          {message}
        </p>
      </main>
    );
  }

  return (
    <>
      <TripHeader title={trip?.title ?? ""} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <Tabs
          active={tab}
          onChange={onTab}
          labels={{ view: t("tabs.view"), manage: t("tabs.manage") }}
        />
        <div className="mt-4">{tab === "view" ? <ViewTab /> : <ManageTab />}</div>
      </main>
    </>
  );
}
