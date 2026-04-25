"use client";

import { FormEvent, useState } from "react";
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
  const [isManageUnlocked, setIsManageUnlocked] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [managePasswordInput, setManagePasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");

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

  function requestTabChange(next: "view" | "manage") {
    if (next === "view") {
      onTab("view");
      return;
    }
    const requiredPassword = trip?.managePassword ?? "";
    if (!requiredPassword) {
      setIsManageUnlocked(true);
      onTab("manage");
      return;
    }
    if (isManageUnlocked) {
      onTab("manage");
      return;
    }
    setShowPasswordPrompt(true);
    setManagePasswordInput("");
    setPasswordError("");
  }

  function unlockManageTab(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const requiredPassword = trip?.managePassword ?? "";
    if (!requiredPassword) {
      setShowPasswordPrompt(false);
      setIsManageUnlocked(true);
      onTab("manage");
      return;
    }
    if (managePasswordInput === requiredPassword) {
      setShowPasswordPrompt(false);
      setIsManageUnlocked(true);
      setManagePasswordInput("");
      setPasswordError("");
      onTab("manage");
      return;
    }
    setPasswordError("Wrong password. Try again.");
  }

  return (
    <>
      <TripHeader title={trip?.title ?? ""} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        <Tabs
          active={tab}
          onChange={requestTabChange}
          labels={{ view: t("tabs.view"), manage: t("tabs.manage") }}
        />
        {showPasswordPrompt ? (
          <section className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Manage password required
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              Enter the trip password to unlock the Manage tab.
            </p>
            <form className="mt-3 flex gap-2" onSubmit={unlockManageTab}>
              <input
                type="password"
                autoFocus
                value={managePasswordInput}
                onChange={(e) => {
                  setManagePasswordInput(e.target.value);
                  if (passwordError) setPasswordError("");
                }}
                className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                placeholder="Password"
              />
              <button
                type="submit"
                className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
              >
                Unlock
              </button>
            </form>
            {passwordError ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{passwordError}</p>
            ) : null}
          </section>
        ) : null}
        <div className="mt-4">{tab === "view" ? <ViewTab /> : <ManageTab />}</div>
      </main>
    </>
  );
}
