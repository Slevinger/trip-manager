"use client";

import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearCanonicalTripLiveLocation,
  saveCanonicalTrip,
  sessionIsGoogleSignIn,
  subscribeCanonicalTrip,
  updateCanonicalTripLiveLocation,
} from "@/lib/canonicalTripsFirestore";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { TripMapLoadingPlaceholder } from "@/components/trip/TripMapLoadingPlaceholder";
import { UserMenu } from "@/components/UserMenu";
import { useI18n } from "@/lib/i18n/context";
import { ManageTripWorkspace } from "@/components/manage/ManageTripWorkspace";
import { TripCurrentStepDashboard } from "@/components/trip/TripCurrentStepDashboard";
import { TripDestinationsRoster } from "@/components/trip/TripDestinationsRoster";
import { TripViewSummary } from "@/components/trip/TripViewSummary";
import { getClientAuth, getClientStorage, getDb, getMissingFirebasePublicEnv } from "@/lib/firebase";
import { normalizeTripForPersist } from "@/lib/canonicalStepBuilders";
import { upsertDestinationRow } from "@/lib/tripDestinationRegistry";
import { destinationHasMapCoordinates } from "@/lib/tripDestinationGeo";
import { getTrip, putTrip } from "@/lib/tripLocalStore";
import { sortTripStepsByStartTime } from "@/lib/tripStepSort";
import { getTripViewPhase, resolveCurrentStepForDashboard } from "@/lib/tripViewPhase";
import type { Destination, Trip, UserPreferences } from "@/lib/types/trip";
import { messagesForTrip } from "@/lib/tripChatMessages";
import type {
  ImmutableMemoryQueueEntry,
  SharedTripThreadEntry,
  TripChatMessage,
} from "@/lib/types/user";
import {
  subscribeImmutableMemoryQueueEntries,
  subscribeTripAssistantChat,
  subscribeUser,
} from "@/lib/usersFirestore";
import { subscribeSharedTripThread } from "@/lib/sharedTripThread";

function toLocalDateTimeInputValue(epochMs: number): string {
  const d = new Date(epochMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

const TripItineraryMap = dynamic(
  () =>
    import("@/components/trip/TripItineraryMap").then((mod) => ({ default: mod.TripItineraryMap })),
  {
    ssr: false,
    loading: () => <TripMapLoadingPlaceholder />,
  }
);

const CreateDestinationDialog = dynamic(
  () =>
    import("@/components/manage/CreateDestinationDialog").then((m) => ({
      default: m.CreateDestinationDialog,
    })),
  { ssr: false }
);

const TripAssistantChatDock = dynamic(
  () =>
    import("@/components/trip/TripAssistantChatDock").then((m) => ({
      default: m.TripAssistantChatDock,
    })),
  { ssr: false }
);

export function TripDetail({ tripId }: { tripId: string }) {
  const [tab, setTab] = useState<"view" | "manage">("view");
  const [loadState, setLoadState] = useState<
    "loading" | "ok" | "missing" | "needs_auth" | "needs_google" | "access_denied"
  >("loading");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [manageDraft, setManageDraft] = useState<Trip | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [canManageFirestore, setCanManageFirestore] = useState(false);
  const [isTripOwner, setIsTripOwner] = useState(false);
  const [advancedJson, setAdvancedJson] = useState("");
  const [viewNowMs, setViewNowMs] = useState(() => Date.now());
  const [simulateLocalDateTimeEnabled, setSimulateLocalDateTimeEnabled] = useState(false);
  const [simulatedLocalDateTime, setSimulatedLocalDateTime] = useState(() =>
    toLocalDateTimeInputValue(Date.now())
  );
  const [liveLocationSharing, setLiveLocationSharing] = useState(false);
  const [liveLocationError, setLiveLocationError] = useState<string | null>(null);
  const [destinationLocationDialogOpen, setDestinationLocationDialogOpen] = useState(false);
  const [destinationLocationEditSnapshot, setDestinationLocationEditSnapshot] =
    useState<Destination | null>(null);
  const [profilePreferences, setProfilePreferences] = useState<UserPreferences | null>(null);
  const [chatMemory, setChatMemory] = useState<TripChatMessage[]>([]);
  const [immutableQueue, setImmutableQueue] = useState<{
    loaded: boolean;
    entries: ImmutableMemoryQueueEntry[];
  }>({ loaded: false, entries: [] });
  const [sharedThread, setSharedThread] = useState<{
    loaded: boolean;
    entries: SharedTripThreadEntry[];
  }>({ loaded: false, entries: [] });
  /** Canonical transcript doc `users/.../tripAssistantChats/{tripId}` when present. */
  const [assistantChatDoc, setAssistantChatDoc] = useState<{
    exists: boolean;
    messages: TripChatMessage[];
  }>({ exists: false, messages: [] });
  const liveLocationWatchIdRef = useRef<number | null>(null);
  const liveLocationLastSentRef = useRef<{ ts: number; lat: number; lon: number } | null>(null);

  const { t } = useI18n();
  const useFirestore = Boolean(getDb() && getMissingFirebasePublicEnv().length === 0);
  const liveLocationUserKey = (user?.email ?? "").trim().toLowerCase();

  const saveTargetLabel = useMemo(
    () => (useFirestore && user ? t("trip.saveTargetFirestore") : t("trip.saveTargetLocal")),
    [useFirestore, user, t]
  );

  useEffect(() => {
    if (tab !== "view") return;
    setViewNowMs(Date.now());
    const id = window.setInterval(() => setViewNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [tab]);

  useEffect(() => {
    if (simulateLocalDateTimeEnabled || tab !== "view") return;
    setSimulatedLocalDateTime(toLocalDateTimeInputValue(viewNowMs));
  }, [simulateLocalDateTimeEnabled, tab, viewNowMs]);

  useEffect(() => {
    if (!useFirestore || !user?.email?.trim()) {
      setProfilePreferences(null);
      setChatMemory([]);
      return () => {};
    }
    return subscribeUser(user.email!, (u) => {
      setProfilePreferences(u?.preferences ?? null);
      setChatMemory(u?.memory ?? []);
    });
  }, [useFirestore, user]);

  useEffect(() => {
    if (!useFirestore || !user?.email?.trim()) {
      setAssistantChatDoc({ exists: false, messages: [] });
      return () => {};
    }
    const tid = tripId.trim();
    if (!tid) {
      setAssistantChatDoc({ exists: false, messages: [] });
      return () => {};
    }
    const email = user.email!.trim();
    return subscribeTripAssistantChat(email, tid, email, setAssistantChatDoc);
  }, [useFirestore, user?.email, tripId]);

  useEffect(() => {
    if (!useFirestore || !user?.email?.trim()) {
      setImmutableQueue({ loaded: false, entries: [] });
      return () => {};
    }
    const email = user.email!.trim();
    return subscribeImmutableMemoryQueueEntries(
      email,
      (rows) => setImmutableQueue({ loaded: true, entries: rows }),
      () => setImmutableQueue({ loaded: true, entries: [] })
    );
  }, [useFirestore, user?.email]);

  useEffect(() => {
    if (!useFirestore || !tripId) {
      setSharedThread({ loaded: false, entries: [] });
      return () => {};
    }
    return subscribeSharedTripThread(
      tripId,
      (rows) => setSharedThread({ loaded: true, entries: rows }),
      () => setSharedThread({ loaded: true, entries: [] })
    );
  }, [useFirestore, tripId]);

  useEffect(() => {
    setLoadState("loading");
    setSaveError(null);
    const db = getDb();
    const auth = getClientAuth();
    const missing = getMissingFirebasePublicEnv();

    if (!db || missing.length > 0) {
      const t = getTrip(tripId);
      if (!t) {
        setTrip(null);
        setLoadState("missing");
        return;
      }
      setTrip(t);
      setLoadState("ok");
      return;
    }

    let unsubTrip: (() => void) | undefined;
    let cancelled = false;
    const unsubAuth = onAuthStateChanged(auth!, (u) => {
      void (async () => {
        setUser(u);
        setCanManageFirestore(false);
        unsubTrip?.();
        unsubTrip = undefined;
        if (cancelled) return;
        if (!u) {
          setTrip(null);
          setLoadState("needs_auth");
          return;
        }
        const google = await sessionIsGoogleSignIn(u);
        if (cancelled) return;
        if (!google) {
          setTrip(null);
          setLoadState("needs_google");
          return;
        }
        unsubTrip = subscribeCanonicalTrip(
          db,
          tripId,
          u,
          (t, access) => {
            if (!t) {
              setTrip(null);
              setCanManageFirestore(false);
              setIsTripOwner(false);
              setLoadState("missing");
              return;
            }
            setTrip(t);
            setCanManageFirestore(access?.canManageFirestore ?? false);
            setIsTripOwner(access?.isOwner ?? false);
            setLoadState("ok");
          },
          (err) => {
            const code =
              typeof err === "object" && err !== null && "code" in err
                ? String((err as { code?: string }).code)
                : "";
            if (code.includes("permission-denied")) {
              setTrip(null);
              setCanManageFirestore(false);
              setIsTripOwner(false);
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
  }, [tripId]);

  useEffect(() => {
    if (tab === "view") {
      setManageDraft(null);
      return;
    }
    setManageDraft((d) => {
      if (!trip) return null;
      if (!d || d.id !== trip.id) return { ...trip };
      return d;
    });
  }, [tab, trip]);

  const sortedSteps = useMemo(() => {
    if (!trip) return [];
    return sortTripStepsByStartTime(trip.steps);
  }, [trip]);

  const effectiveNowMs = useMemo(() => {
    if (!simulateLocalDateTimeEnabled) return viewNowMs;
    const parsed = Date.parse(simulatedLocalDateTime);
    return Number.isFinite(parsed) ? parsed : viewNowMs;
  }, [simulateLocalDateTimeEnabled, simulatedLocalDateTime, viewNowMs]);

  const viewPhase = useMemo(
    () => (trip ? getTripViewPhase(trip, effectiveNowMs) : "before_start"),
    [trip, effectiveNowMs]
  );

  const viewStepFocus = useMemo(
    () => (trip ? resolveCurrentStepForDashboard(trip, effectiveNowMs) : { kind: "none" as const }),
    [trip, effectiveNowMs]
  );

  const destinationsMissingMapCoordinates = useMemo(() => {
    if (!trip?.destinations?.length) return [];
    return trip.destinations.filter((d) => !destinationHasMapCoordinates(d));
  }, [trip]);

  const canEditTripDestinations = !useFirestore || (Boolean(user) && canManageFirestore);

  const canUploadTripFiles = Boolean(
    useFirestore && user && canManageFirestore && getDb() && getClientStorage()
  );
  const canShareLiveLocation = Boolean(
    tab === "view" && useFirestore && user && canManageFirestore && trip?.id && liveLocationUserKey && getDb()
  );
  const liveLocationDisplayName = useMemo(() => {
    const fallback = t("trip.liveLocationDefaultName");
    if (!trip || !liveLocationUserKey) return fallback;
    const traveler = trip.travelers.find((row) => (row.email ?? "").trim().toLowerCase() === liveLocationUserKey);
    if (traveler?.name?.trim()) return traveler.name.trim();
    const viewer = (trip.viewers ?? []).find(
      (row) => (row.email ?? "").trim().toLowerCase() === liveLocationUserKey
    );
    if (viewer?.name?.trim()) return viewer.name.trim();
    return fallback;
  }, [trip, liveLocationUserKey, t]);
  const uploadDisabledHint = useMemo(() => {
    if (!useFirestore) return t("trip.uploadHintNoFirestore");
    if (!user) return t("trip.uploadHintSignIn");
    if (!getClientStorage()) return t("trip.uploadHintStorage");
    return undefined;
  }, [useFirestore, user, t]);

  useEffect(() => {
    if (!canShareLiveLocation || !liveLocationSharing) {
      if (liveLocationWatchIdRef.current != null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(liveLocationWatchIdRef.current);
        liveLocationWatchIdRef.current = null;
      }
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLiveLocationError(t("trip.liveLocationNoGeolocation"));
      return;
    }
    const db = getDb();
    if (!db || !trip?.id) return;
    setLiveLocationError(null);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const now = Date.now();
        const prev = liveLocationLastSentRef.current;
        if (prev) {
          const minIntervalMs = 15_000;
          const minDelta = 0.0001;
          if (now - prev.ts < minIntervalMs && Math.abs(prev.lat - lat) < minDelta && Math.abs(prev.lon - lon) < minDelta) {
            return;
          }
        }
        liveLocationLastSentRef.current = { ts: now, lat, lon };
        void updateCanonicalTripLiveLocation(db, trip.id, liveLocationUserKey, {
          name: liveLocationDisplayName,
          lat,
          lon,
          updatedAt: new Date().toISOString(),
        }).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          setLiveLocationError(msg || t("trip.liveLocationUpdateFailed"));
        });
      },
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? t("trip.liveLocationPermissionDenied")
            : err.message || t("trip.liveLocationUpdateFailed");
        setLiveLocationError(msg);
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );
    liveLocationWatchIdRef.current = watchId;
    return () => {
      if (liveLocationWatchIdRef.current != null) {
        navigator.geolocation.clearWatch(liveLocationWatchIdRef.current);
        liveLocationWatchIdRef.current = null;
      }
    };
  }, [canShareLiveLocation, liveLocationDisplayName, liveLocationSharing, liveLocationUserKey, t, trip?.id]);

  useEffect(() => {
    if (liveLocationSharing || !canShareLiveLocation) return;
    const db = getDb();
    if (!db || !trip?.id) return;
    void clearCanonicalTripLiveLocation(db, trip.id, liveLocationUserKey).catch(() => {});
  }, [canShareLiveLocation, liveLocationSharing, liveLocationUserKey, trip?.id]);

  async function persistTrip(next: Trip) {
    setSaveError(null);
    try {
      const normalized = normalizeTripForPersist(next);
      const db = getDb();
      if (useFirestore && db && user) {
        await saveCanonicalTrip(db, normalized, user);
        setTrip(normalized);
        setManageDraft(normalized);
        return;
      }
      putTrip(normalized);
      const saved = getTrip(tripId);
      setTrip(saved);
      setManageDraft(saved ?? normalized);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg);
      throw e;
    }
  }

  async function handleViewDestinationLocationSave(updated: Destination) {
    if (!trip) return;
    const next: Trip = {
      ...trip,
      destinations: upsertDestinationRow(trip.destinations, updated),
      updatedAt: new Date().toISOString(),
    };
    await persistTrip(normalizeTripForPersist(next));
  }

  async function handleViewDestinationDelete(id: string) {
    if (!trip) return;
    const next: Trip = {
      ...trip,
      destinations: trip.destinations.filter((d) => d.id !== id),
      updatedAt: new Date().toISOString(),
    };
    await persistTrip(normalizeTripForPersist(next));
  }

  async function handleSaveAdvancedJson() {
    setSaveError(null);
    try {
      const parsed = JSON.parse(advancedJson) as Trip;
      if (!parsed || typeof parsed !== "object" || parsed.id !== tripId) {
        setSaveError(t("trip.jsonIdMismatch"));
        return;
      }
      const withMeta = { ...parsed, updatedAt: new Date().toISOString() };
      const normalized = normalizeTripForPersist(withMeta);
      const db = getDb();
      if (useFirestore && db && user) {
        await saveCanonicalTrip(db, normalized, user);
        setTrip(normalized);
        setManageDraft(normalized);
        setAdvancedJson(JSON.stringify(normalized, null, 2));
        return;
      }
      putTrip(normalized);
      const saved = getTrip(tripId);
      setTrip(saved);
      const next = saved ?? normalized;
      setManageDraft(next);
      setAdvancedJson(JSON.stringify(next, null, 2));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  const dockTrip = !trip ? null : tab === "manage" && manageDraft ? manageDraft : trip;
  /**
   * Trip-shared history for the dock UI and the LLM call. Sourced from the shared
   * `trips/{id}/assistantThread` so all members of the trip see the same conversation.
   * Falls back to the legacy per-user trip transcript when the shared thread is empty
   * (so old trips that never used the shared thread still render their history).
   */
  const tripChatMessages = useMemo(() => {
    if (!dockTrip?.id) return [];
    if (sharedThread.loaded) {
      const fromShared = sharedThread.entries
        .filter((e) => e.active && e.tripId === dockTrip.id)
        .slice(-40)
        .map((e) => ({
          tripId: e.tripId,
          from: e.from,
          content: e.content,
          timeStamp: new Date(e.createdAtMs).toISOString(),
          ...(e.memoryCompressed === true ? { memoryCompressed: true as const } : {}),
        }));
      if (fromShared.length > 0) return fromShared;
    }
    if (assistantChatDoc.exists) return assistantChatDoc.messages;
    return messagesForTrip(chatMemory, dockTrip.id);
  }, [
    assistantChatDoc.exists,
    assistantChatDoc.messages,
    chatMemory,
    dockTrip?.id,
    sharedThread.loaded,
    sharedThread.entries,
  ]);

  /**
   * Cross-trip `__global__` entries (trip-agnostic). The dock attaches these to the
   * LLM call ONLY when the current request is classified as general (preferences /
   * cross-trip). Stays separate from `tripChatMessages` so the per-trip UI thread
   * isn't polluted with other trips' content.
   */
  const globalChatMessages = useMemo(() => {
    if (!immutableQueue.loaded) return [];
    return immutableQueue.entries
      .filter((e) => e.active && e.tripId === "__global__")
      .slice(-10)
      .map((e) => ({
        tripId: e.tripId,
        from: e.from,
        content: e.content,
        timeStamp: new Date(e.createdAtMs).toISOString(),
        ...(e.memoryCompressed === true ? { memoryCompressed: true as const } : {}),
      }));
  }, [immutableQueue.loaded, immutableQueue.entries]);

  if (loadState === "loading") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("trip.loading")}</p>
      </main>
    );
  }

  if (loadState === "needs_auth") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-50">{t("trip.signInRequired")}</p>
        <p className="mt-2 text-sm text-zinc-500">{t("trip.signInRequiredBody")}</p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-violet-600 dark:text-violet-400">
          {t("trip.homeToSignIn")}
        </Link>
      </main>
    );
  }

  if (loadState === "needs_google") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-50">{t("trip.googleRequired")}</p>
        <p className="mt-2 text-sm text-zinc-500">{t("trip.googleRequiredBody")}</p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-violet-600 dark:text-violet-400">
          {t("trip.homeToGoogle")}
        </Link>
      </main>
    );
  }

  if (loadState === "access_denied") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-50">{t("trip.accessDenied")}</p>
        <p className="mt-2 text-sm text-zinc-500">{t("trip.accessDeniedBody")}</p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-violet-600 dark:text-violet-400">
          {t("trip.backToTrips")}
        </Link>
      </main>
    );
  }

  if (loadState === "missing" || !trip) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-50">{t("trip.notFound")}</p>
        <p className="mt-2 text-sm text-zinc-500">{t("trip.notFoundBody")}</p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-violet-600 dark:text-violet-400">
          {t("trip.backToTrips")}
        </Link>
      </main>
    );
  }

  const displayTitle = tab === "manage" && manageDraft ? manageDraft.title : trip.title;

  /** Chat only on this trip’s loaded doc; Firestore viewers (read-only) never see it. Local trips have no viewer role. */
  const showTripAssistant = trip.id === tripId && (!useFirestore || canManageFirestore);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          {t("trip.allTrips")}
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setTab("view")}
              className={
                tab === "view"
                  ? "rounded-md bg-white px-3 py-1.5 text-xs font-semibold shadow dark:bg-zinc-800"
                  : "rounded-md px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400"
              }
            >
              {t("trip.view")}
            </button>
            {useFirestore && !canManageFirestore ? null : (
              <button
                type="button"
                onClick={() => setTab("manage")}
                className={
                  tab === "manage"
                    ? "rounded-md bg-white px-3 py-1.5 text-xs font-semibold shadow dark:bg-zinc-800"
                    : "rounded-md px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400"
                }
              >
                {t("trip.manage")}
              </button>
            )}
          </div>
          {user ? <UserMenu user={user} /> : null}
        </div>
      </div>

      <h1 className="mt-6 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{displayTitle}</h1>
      <p className="mt-1 font-mono text-xs text-zinc-500">{trip.id}</p>

      {tab === "view" ? (
        <>
          <section className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/40">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <input
                  type="checkbox"
                  checked={simulateLocalDateTimeEnabled}
                  onChange={(e) => setSimulateLocalDateTimeEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800"
                />
                {t("trip.timeSimulationLabel")}
              </label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {simulateLocalDateTimeEnabled
                  ? t("trip.timeSimulationSimulated")
                  : t("trip.timeSimulationLive")}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label
                htmlFor="trip-local-datetime-sim"
                className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
              >
                {t("trip.timeSimulationDateTime")}
              </label>
              <input
                id="trip-local-datetime-sim"
                type="datetime-local"
                value={simulatedLocalDateTime}
                disabled={!simulateLocalDateTimeEnabled}
                onChange={(e) => setSimulatedLocalDateTime(e.target.value)}
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t("trip.timeSimulationHelp")}</p>
          </section>
          {useFirestore ? (
            <section className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/40">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={liveLocationSharing}
                    disabled={!canShareLiveLocation}
                    onChange={(e) => {
                      setLiveLocationError(null);
                      setLiveLocationSharing(e.target.checked);
                    }}
                    className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800"
                  />
                  {t("trip.liveLocationToggle")}
                </label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {liveLocationSharing
                    ? t("trip.liveLocationStatusSharing")
                    : t("trip.liveLocationStatusOff")}
                </p>
              </div>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                {canShareLiveLocation
                  ? t("trip.liveLocationHelp")
                  : t("trip.liveLocationRequiresTraveler")}
              </p>
              {liveLocationError ? (
                <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">{liveLocationError}</p>
              ) : null}
            </section>
          ) : null}
          {destinationsMissingMapCoordinates.length > 0 ? (
            <aside
              className="mt-6 rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
              role="status"
            >
              <p className="font-medium">
                {destinationsMissingMapCoordinates.length === 1
                  ? t("trip.destMissingOne")
                  : t("trip.destMissingMany", { count: destinationsMissingMapCoordinates.length })}{" "}
                {t("trip.destMissingSuffix")}
              </p>
              <ul className="mt-2 space-y-1.5">
                {destinationsMissingMapCoordinates.map((d) => {
                  const label = (d.title || d.location || t("common.untitled")).trim() || t("common.untitled");
                  return (
                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                      <span className="text-amber-900/90 dark:text-amber-100/90">{label}</span>
                      {canEditTripDestinations ? (
                        <button
                          type="button"
                          className="rounded-lg bg-amber-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-900 dark:bg-amber-600 dark:hover:bg-amber-500"
                          onClick={() => {
                            setDestinationLocationEditSnapshot({ ...d });
                            setDestinationLocationDialogOpen(true);
                          }}
                        >
                          {t("trip.setLocation")}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {!canEditTripDestinations && useFirestore ? (
                <p className="mt-2 text-xs text-amber-900/80 dark:text-amber-200/80">{t("trip.destReadOnlyHint")}</p>
              ) : null}
            </aside>
          ) : null}
          <TripItineraryMap
            tripId={trip.id}
            sortedSteps={sortedSteps}
            destinations={trip.destinations}
            liveLocations={trip.liveLocations}
            focus={viewStepFocus}
            nowMs={effectiveNowMs}
            onDestinationDblClick={
              canEditTripDestinations
                ? (destinationId) => {
                    const d = trip.destinations.find((x) => x.id === destinationId);
                    if (!d) return;
                    setDestinationLocationEditSnapshot({ ...d });
                    setDestinationLocationDialogOpen(true);
                  }
                : undefined
            }
          />
          <CreateDestinationDialog
            open={destinationLocationDialogOpen}
            onOpenChange={(open) => {
              setDestinationLocationDialogOpen(open);
              if (!open) setDestinationLocationEditSnapshot(null);
            }}
            existingDestination={destinationLocationEditSnapshot}
            onSave={handleViewDestinationLocationSave}
          />
          {viewPhase === "before_start" ? (
            <TripViewSummary trip={trip} sortedSteps={sortedSteps} nowMs={effectiveNowMs} variant="default" />
          ) : null}
          {viewPhase === "during" ? (
            <TripCurrentStepDashboard trip={trip} focus={viewStepFocus} nowMs={effectiveNowMs} />
          ) : null}
          {viewPhase === "after_end" ? (
            <TripViewSummary trip={trip} sortedSteps={sortedSteps} nowMs={effectiveNowMs} variant="ended" />
          ) : null}
          <div className="mt-8">
            <TripDestinationsRoster
              destinations={trip.destinations}
              steps={sortedSteps}
              editable={canEditTripDestinations}
              manageHint={false}
              onSaveDestination={(d) => void handleViewDestinationLocationSave(d)}
              onDeleteDestination={(id) => void handleViewDestinationDelete(id)}
            />
          </div>
        </>
      ) : manageDraft ? (
        <div className="mt-8 pb-40">
          <ManageTripWorkspace
            trip={manageDraft}
            onTripChange={setManageDraft}
            persistTrip={persistTrip}
            canUploadTripFiles={canUploadTripFiles}
            uploadDisabledHint={uploadDisabledHint}
            saveTarget={saveTargetLabel}
            saveDisabled={useFirestore && (!user || !canManageFirestore)}
            saveError={saveError}
            user={user}
            profilePreferences={profilePreferences}
          />

          <details
            className="mt-8 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
            onToggle={(e) => {
              const el = e.currentTarget;
              if (el.open && manageDraft) {
                setAdvancedJson(JSON.stringify(manageDraft, null, 2));
              }
            }}
          >
            <summary className="cursor-pointer text-xs font-semibold text-zinc-700 dark:text-zinc-200">
              {t("trip.advancedJson")}
            </summary>
            <p className="mt-2 text-xs text-zinc-500">
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">id</code> {t("trip.advancedJsonIdHint")}{" "}
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{tripId}</code>.
            </p>
            <textarea
              className="mt-2 min-h-[200px] w-full rounded-lg border border-zinc-200 bg-white p-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              value={advancedJson}
              onChange={(e) => setAdvancedJson(e.target.value)}
              spellCheck={false}
            />
            {saveError ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{saveError}</p> : null}
            <button
              type="button"
              disabled={useFirestore && (!user || !canManageFirestore)}
              onClick={() => void handleSaveAdvancedJson()}
              className="mt-2 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-zinc-200 dark:text-zinc-900"
            >
              {t("trip.saveFromJson")}
            </button>
          </details>
        </div>
      ) : (
        <p className="mt-8 text-sm text-zinc-500">{t("trip.preparingEditor")}</p>
      )}

      {showTripAssistant ? (
        <TripAssistantChatDock
          trip={dockTrip ?? trip}
          profilePreferences={profilePreferences}
          tripChatMessages={tripChatMessages}
          globalChatMessages={globalChatMessages}
          userEmail={user?.email?.trim() ?? null}
          userDisplayName={user?.displayName?.trim() ?? null}
          isTripOwner={isTripOwner}
          canPersistMemory={Boolean(useFirestore && user?.email?.trim())}
        />
      ) : null}
    </main>
  );
}
