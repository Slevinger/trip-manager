"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { TripHeader } from "@/components/trip/TripHeader";
import { Tabs } from "@/components/trip/Tabs";
import { ViewTab } from "@/components/trip/ViewTab";
import { ManageTab } from "@/components/trip/ManageTab";
import {
  TripDocumentProvider,
  useTripDocument,
} from "@/components/providers/TripDocumentProvider";
import { useI18n } from "@/components/providers/I18nProvider";
import { getClientAuth, getDb, getMissingFirebasePublicEnv } from "@/lib/firebase";

const MANAGE_LOCK_TTL_MS = 45_000;
const MANAGE_LOCK_HEARTBEAT_MS = 15_000;

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
      <TripChrome tripId={tripId} tab={tab} onTab={setTab} />
    </TripDocumentProvider>
  );
}

function TripChrome({
  tripId,
  tab,
  onTab,
}: {
  tripId: string;
  tab: "view" | "manage";
  onTab: (next: "view" | "manage") => void;
}) {
  const { t } = useI18n();
  const { trip, loading, error, user, authNeedsGoogleClick, signInWithGoogle } =
    useTripDocument();
  const [isManageUnlocked, setIsManageUnlocked] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [managePasswordInput, setManagePasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [manageLockError, setManageLockError] = useState("");
  const [hasManageLock, setHasManageLock] = useState(false);
  const db = getDb();
  const lockRef = useMemo(
    () => (db ? doc(db, "trips", tripId, "locks", "manage") : null),
    [db, tripId]
  );
  const lockSessionId = useMemo(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `manage-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }, []);

  const writeLock = useCallback(async () => {
    if (!lockRef) return;
    const auth = getClientAuth();
    const currentUser = auth?.currentUser;
    await setDoc(
      lockRef,
      {
        holderSessionId: lockSessionId,
        holderUid: currentUser?.uid ?? "",
        holderEmail: currentUser?.email ?? "",
        expiresAtMs: Date.now() + MANAGE_LOCK_TTL_MS,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }, [lockRef, lockSessionId]);

  const acquireManageLock = useCallback(async (): Promise<boolean> => {
    if (!lockRef) return false;
    try {
      await runTransaction(lockRef.firestore, async (tx) => {
        const snap = await tx.get(lockRef);
        const now = Date.now();
        const data = (snap.data() ?? {}) as Record<string, unknown>;
        const holderSessionId = String(data.holderSessionId ?? "");
        const expiresAtMs = Number(data.expiresAtMs ?? 0);
        const available =
          !snap.exists() || holderSessionId === lockSessionId || expiresAtMs <= now;
        if (!available) throw new Error("MANAGE_LOCK_HELD");
        const auth = getClientAuth();
        const currentUser = auth?.currentUser;
        tx.set(
          lockRef,
          {
            holderSessionId: lockSessionId,
            holderUid: currentUser?.uid ?? "",
            holderEmail: currentUser?.email ?? "",
            expiresAtMs: now + MANAGE_LOCK_TTL_MS,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      });
      return true;
    } catch {
      return false;
    }
  }, [lockRef, lockSessionId]);

  const releaseManageLock = useCallback(async () => {
    if (!lockRef) return;
    try {
      await runTransaction(lockRef.firestore, async (tx) => {
        const snap = await tx.get(lockRef);
        if (!snap.exists()) return;
        const data = (snap.data() ?? {}) as Record<string, unknown>;
        const holderSessionId = String(data.holderSessionId ?? "");
        if (holderSessionId !== lockSessionId) return;
        tx.delete(lockRef);
      });
    } catch {
      /* ignore */
    }
  }, [lockRef, lockSessionId]);

  useEffect(() => {
    if (!lockRef) return;
    return onSnapshot(
      lockRef,
      (snap) => {
        if (!snap.exists() || tab !== "manage") return;
        const data = (snap.data() ?? {}) as Record<string, unknown>;
        const holderSessionId = String(data.holderSessionId ?? "");
        const expiresAtMs = Number(data.expiresAtMs ?? 0);
        if (holderSessionId !== lockSessionId && expiresAtMs > Date.now()) {
          setHasManageLock(false);
          setManageLockError("Manage tab is currently open in another browser.");
          onTab("view");
        }
      },
      () => {
        // Firestore rules may deny lock doc reads for some users; avoid uncaught listener crashes.
        setManageLockError("Unable to observe manage lock.");
      }
    );
  }, [lockRef, lockSessionId, onTab, tab]);

  useEffect(() => {
    if (tab !== "manage" || !hasManageLock) return;
    const id = window.setInterval(() => {
      void writeLock();
    }, MANAGE_LOCK_HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [hasManageLock, tab, writeLock]);

  useEffect(() => {
    return () => {
      if (hasManageLock) void releaseManageLock();
    };
  }, [hasManageLock, releaseManageLock]);

  const openManageWithLock = useCallback(async () => {
    setManageLockError("");
    const ok = await acquireManageLock();
    if (!ok) {
      setManageLockError("Manage tab is currently open in another browser.");
      return;
    }
    setHasManageLock(true);
    setIsManageUnlocked(true);
    onTab("manage");
  }, [acquireManageLock, onTab]);

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-zinc-500">
        {t("common.loading")}
      </main>
    );
  }

  if (error) {
    const message =
      error === "firebase"
          ? t("firebase.missing")
        : error === "ACCESS_DENIED"
          ? t("access.denied")
        : error === "AUTH_REQUIRED"
          ? t("auth.googleRequired")
        : error === "AUTH_EMAIL_REQUIRED"
          ? t("auth.emailRequired")
        : error === "AUTH_POPUP_BLOCKED"
          ? t("auth.popupBlocked")
        : error === "AUTH_REDIRECT_LOOP"
          ? t("auth.redirectLoop")
        : error === "FIRESTORE_READ_DENIED"
          ? t("firebase.permissionDenied")
          : error.includes("permission-denied") ||
              error.includes("Missing or insufficient permissions")
            ? t("firebase.permissionDenied")
          : error.includes("auth/configuration-not-found")
            ? t("firebase.authNotEnabled")
            : `${t("common.error")}: ${error}`;
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
          {message}
        </p>
        {error === "ACCESS_DENIED" ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            {t("access.inviteHint")}
          </p>
        ) : null}
      </main>
    );
  }

  if (authNeedsGoogleClick) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {t("auth.continueTitle")}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            {t("auth.continueHint")}
          </p>
          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            className="mt-6 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
          >
            {t("auth.continueWithGoogle")}
          </button>
        </section>
      </main>
    );
  }

  function requestTabChange(next: "view" | "manage") {
    if (next === "view") {
      if (hasManageLock) {
        setHasManageLock(false);
        void releaseManageLock();
      }
      onTab("view");
      return;
    }
    const requiredPassword = trip?.managePassword ?? "";
    if (!requiredPassword) {
      void openManageWithLock();
      return;
    }
    if (isManageUnlocked) {
      void openManageWithLock();
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
      void openManageWithLock();
      return;
    }
    if (managePasswordInput === requiredPassword) {
      setShowPasswordPrompt(false);
      setManagePasswordInput("");
      setPasswordError("");
      void openManageWithLock();
      return;
    }
    setPasswordError("Wrong password. Try again.");
  }

  return (
    <>
      <TripHeader title={trip?.title ?? ""} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        {user?.email ? (
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            {t("auth.signedInAs")}: {user.email}
          </p>
        ) : null}
        <Tabs
          active={tab}
          onChange={requestTabChange}
          labels={{ view: t("tabs.view"), manage: t("tabs.manage") }}
        />
        {manageLockError ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            {manageLockError}
          </p>
        ) : null}
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
