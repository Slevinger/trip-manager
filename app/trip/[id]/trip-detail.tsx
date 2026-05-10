"use client";

import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearCanonicalTripLiveLocation,
  ensureCanonicalTripListsMyUid,
  saveCanonicalTrip,
  sessionIsGoogleSignIn,
  subscribeCanonicalTrip,
  updateCanonicalTripLiveLocation,
} from "@/lib/canonicalTripsFirestore";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Popover } from "@/components/popover/Popover";
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
import { addTripRecommendation } from "@/lib/tripRecommendations";
import { sortTripStepsByStartTime } from "@/lib/tripStepSort";
import { getTripViewPhase, resolveCurrentStepForDashboard } from "@/lib/tripViewPhase";
import type { Destination, Traveler, Trip, TripRecommendation, TripViewer, UserPreferences } from "@/lib/types/trip";
import { messagesForTrip } from "@/lib/tripChatMessages";
import { loadTripChatLocal } from "@/lib/tripChatLocalStore";
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
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  redo as redoAction,
  setActiveTripId,
  setManageDraft as setManageDraftAction,
  setTrip as setTripAction,
  undo as undoAction,
} from "@/lib/store/tripSlice";

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

const TripAssistantChatDock = dynamic<{
  trip: Trip;
  profilePreferences: UserPreferences | null;
  tripChatMessages: TripChatMessage[];
  globalChatMessages?: TripChatMessage[];
  userEmail: string | null;
  userDisplayName?: string | null;
  isTripOwner?: boolean;
  canPersistMemory: boolean;
  onAddRecommendations?: (trip: Trip, recommendations: TripRecommendation[]) => Promise<void>;
  openRequest?: number;
  onRequestHide?: () => void;
}>(
  () =>
    import("@/components/trip/TripAssistantChatDock").then((m) => ({
      default: m.TripAssistantChatDock,
    })),
  { ssr: false }
);

const TripRecommendationsDock = dynamic<{
  trip: Trip;
  canModify: boolean;
  onPersist: (next: Trip) => Promise<void>;
  openRequest?: number;
  onRequestHide?: () => void;
}>(
  () =>
    import("@/components/trip/TripRecommendationsDock").then((m) => ({
      default: m.TripRecommendationsDock,
    })),
  { ssr: false }
);

const TripGmailDocumentsPanel = dynamic(
  () =>
    import("@/components/trip/TripGmailDocumentsPanel").then((m) => ({
      default: m.TripGmailDocumentsPanel,
    })),
  { ssr: false }
);

export function TripDetail({ tripId }: { tripId: string }) {
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState<"view" | "manage">("view");
  const [viewSubTab, setViewSubTab] = useState<"itinerary" | "places">("itinerary");
  const [loadState, setLoadState] = useState<
    "loading" | "ok" | "missing" | "needs_auth" | "needs_google" | "access_denied"
  >("loading");
  const trip = useAppSelector((s) => s.trip.trip);
  const manageDraft = useAppSelector((s) => s.trip.draft);
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
  /** Lets travelers/viewers register `participantUids` once per trip+user for home-list queries. */
  const participantUidSelfHealKeyRef = useRef<string>("");

  const { t, locale } = useI18n();
  const useFirestore = Boolean(getDb() && getMissingFirebasePublicEnv().length === 0);
  const liveLocationUserKey = (user?.email ?? "").trim().toLowerCase();

  const canUndo = useAppSelector((s) => s.trip.past.length > 0);
  const canRedo = useAppSelector((s) => s.trip.future.length > 0);
  const [chatDockVisible, setChatDockVisible] = useState(true);
  const [recsDockVisible, setRecsDockVisible] = useState(true);
  const [chatOpenRequest, setChatOpenRequest] = useState<number | undefined>(undefined);
  const [recsOpenRequest, setRecsOpenRequest] = useState<number | undefined>(undefined);

  useEffect(() => {
    dispatch(setActiveTripId(tripId));
  }, [dispatch, tripId]);

  const setTripState = (next: Trip | null, opts?: { skipHistory?: boolean }) => {
    if (opts?.skipHistory) {
      dispatch({ type: setTripAction.type, payload: next, meta: { history: "skip" } });
      return;
    }
    dispatch(setTripAction(next));
  };

  const setManageDraftState = (next: Trip | null, opts?: { skipHistory?: boolean }) => {
    if (opts?.skipHistory) {
      dispatch({ type: setManageDraftAction.type, payload: next, meta: { history: "skip" } });
      return;
    }
    dispatch(setManageDraftAction(next));
  };

  const saveTargetLabel = useMemo(
    () => (useFirestore && user ? t("trip.saveTargetFirestore") : t("trip.saveTargetLocal")),
    [useFirestore, user, t]
  );

  /**
   * Whether the manage draft has uncommitted edits compared to the canonical
   * `trip` snapshot. JSON stringify is fine here — Trip objects are small and
   * we already pay this cost for advanced-JSON / Firestore writes.
   */
  const manageDirty = useMemo(() => {
    if (!trip || !manageDraft) return false;
    return JSON.stringify(trip) !== JSON.stringify(manageDraft);
  }, [trip, manageDraft]);

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
        setTripState(null, { skipHistory: true });
        setLoadState("missing");
        return;
      }
      setTripState(t, { skipHistory: true });
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
          setTripState(null, { skipHistory: true });
          setLoadState("needs_auth");
          return;
        }
        const google = await sessionIsGoogleSignIn(u);
        if (cancelled) return;
        if (!google) {
          setTripState(null, { skipHistory: true });
          setLoadState("needs_google");
          return;
        }
        unsubTrip = subscribeCanonicalTrip(
          db,
          tripId,
          u,
          (t, access) => {
            if (!t) {
              setTripState(null, { skipHistory: true });
              setCanManageFirestore(false);
              setIsTripOwner(false);
              setLoadState("missing");
              return;
            }
            setTripState(t, { skipHistory: true });
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
              setTripState(null, { skipHistory: true });
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
    participantUidSelfHealKeyRef.current = "";
  }, [tripId]);

  useEffect(() => {
    if (loadState !== "ok" || !trip || !user) return;
    const db = getDb();
    if (!db || getMissingFirebasePublicEnv().length > 0) return;
    const key = `${tripId}:${user.uid}`;
    if (participantUidSelfHealKeyRef.current === key) return;
    participantUidSelfHealKeyRef.current = key;
    void ensureCanonicalTripListsMyUid(db, tripId, user).catch(() => {
      if (participantUidSelfHealKeyRef.current === key) participantUidSelfHealKeyRef.current = "";
    });
  }, [loadState, trip, tripId, user]);

  useEffect(() => {
    if (tab === "view") {
      setManageDraftState(null, { skipHistory: true });
      return;
    }
    if (!trip) {
      setManageDraftState(null, { skipHistory: true });
      return;
    }
    if (!manageDraft || manageDraft.id !== trip.id) {
      setManageDraftState({ ...trip }, { skipHistory: true });
    }
  }, [tab, trip, manageDraft]);

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
    return trip.destinations.filter((d: Destination) => !destinationHasMapCoordinates(d));
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
    const traveler = trip.travelers.find(
      (row: Traveler) => (row.email ?? "").trim().toLowerCase() === liveLocationUserKey
    );
    if (traveler?.name?.trim()) return traveler.name.trim();
    const viewer = (trip.viewers ?? []).find(
      (row: TripViewer) => (row.email ?? "").trim().toLowerCase() === liveLocationUserKey
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
        setTripState(normalized, { skipHistory: true });
        setManageDraftState(normalized, { skipHistory: true });
        return;
      }
      putTrip(normalized);
      const saved = getTrip(tripId);
      setTripState(saved, { skipHistory: true });
      setManageDraftState(saved ?? normalized, { skipHistory: true });
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
      destinations: trip.destinations.filter((d: Destination) => d.id !== id),
      updatedAt: new Date().toISOString(),
    };
    await persistTrip(normalizeTripForPersist(next));
  }

  /**
   * Handler invoked by `TripAssistantChatDock` when the LLM returned a
   * `trip-suggestions` JSON block. We append every entry to the queue and
   * persist once — the recommendations dock subscribes to the same `Trip`
   * state and surfaces the new bell badge automatically.
   */
  async function handleAddAssistantRecommendations(
    baseTrip: Trip,
    recommendations: TripRecommendation[]
  ): Promise<void> {
    if (recommendations.length === 0) return;
    let next: Trip = baseTrip;
    for (const rec of recommendations) {
      next = addTripRecommendation(next, rec);
    }
    await persistTrip(next);
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
        setTripState(normalized, { skipHistory: true });
        setManageDraftState(normalized, { skipHistory: true });
        setAdvancedJson(JSON.stringify(normalized, null, 2));
        return;
      }
      putTrip(normalized);
      const saved = getTrip(tripId);
      setTripState(saved, { skipHistory: true });
      const next = saved ?? normalized;
      setManageDraftState(next, { skipHistory: true });
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
  /** localStorage fallback: every successful turn is mirrored from the dock,
   * so a refresh on a local-only trip (or a signed-out viewer) still rehydrates
   * the conversation that produced any agent suggestions. Reloaded on tripId
   * change AND whenever the cloud transcripts settle empty (covers the just-
   * after-refresh window before Firestore subscriptions return). */
  const [localChatTrip, setLocalChatTrip] = useState<TripChatMessage[]>([]);
  useEffect(() => {
    const id = dockTrip?.id;
    if (!id) {
      setLocalChatTrip([]);
      return;
    }
    setLocalChatTrip(loadTripChatLocal(id));
  }, [dockTrip?.id]);

  const tripChatMessages = useMemo(() => {
    if (!dockTrip?.id) return [];
    if (sharedThread.loaded) {
      const allForTrip = sharedThread.entries.filter((e) => e.tripId === dockTrip.id);
      // Once a trip has ANY shared-thread entry (even if everyone was just cleared via
      // Forget), treat the shared thread as authoritative. Otherwise an Owner who clears
      // the chat would silently re-surface the legacy `assistantChatDoc.messages` (which
      // still holds the old `LEGEND:` / `CHAT_ONLY_MEMORY:` evolve summary).
      if (allForTrip.length > 0) {
        return allForTrip
          .filter((e) => e.active)
          .slice(-40)
          .map((e) => ({
            tripId: e.tripId,
            from: e.from,
            content: e.content,
            timeStamp: new Date(e.createdAtMs).toISOString(),
            ...(e.memoryCompressed === true ? { memoryCompressed: true as const } : {}),
          }));
      }
    }
    if (assistantChatDoc.exists) return assistantChatDoc.messages;
    const fromLegacy = messagesForTrip(chatMemory, dockTrip.id);
    if (fromLegacy.length > 0) return fromLegacy;
    return localChatTrip;
  }, [
    assistantChatDoc.exists,
    assistantChatDoc.messages,
    chatMemory,
    dockTrip?.id,
    localChatTrip,
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

  const allTripsLink = (
    <Link
      href="/"
      className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      {t("trip.allTrips")}
    </Link>
  );

  const headerControls = (
    <div className="flex items-center gap-2">
      {user ? <UserMenu user={user} /> : null}
      <Popover
        id="popover:trip-hamburger"
        align="end"
        sideOffset={8}
        contentClassName="w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        trigger={({ open, toggle, ref }) => (
          <button
            ref={ref as React.Ref<HTMLButtonElement>}
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={toggle}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white/70 text-zinc-700 shadow-sm hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <span aria-hidden className="text-base leading-none">
              ☰
            </span>
          </button>
        )}
      >
        {({ close }) => (
          <div role="menu">
            <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {t("common.language")}
              </p>
              <div className="mt-2">
                <LanguageSwitcher />
              </div>
            </div>
            <button
              type="button"
              role="menuitem"
              disabled={!showTripAssistant || chatDockVisible}
              onClick={() => {
                setChatDockVisible(true);
                setChatOpenRequest(Date.now());
                close();
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-100 dark:hover:bg-zinc-800/60"
            >
              <span>Chat with agent</span>
              <span className="text-xs text-zinc-400">💬</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={recsDockVisible}
              onClick={() => {
                setRecsDockVisible(true);
                setRecsOpenRequest(Date.now());
                close();
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-100 dark:hover:bg-zinc-800/60"
            >
              <span>Agent suggestions</span>
              <span className="text-xs text-zinc-400">🔔</span>
            </button>
            <div className="border-b border-zinc-100 dark:border-zinc-800" />
            {canUndo ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  dispatch(undoAction());
                  close();
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800/60"
              >
                <span>Undo</span>
                <span className="text-xs text-zinc-400">⌘Z</span>
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              disabled={!canRedo}
              onClick={() => {
                dispatch(redoAction());
                close();
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-100 dark:hover:bg-zinc-800/60"
            >
              <span>Redo</span>
              <span className="text-xs text-zinc-400">⇧⌘Z</span>
            </button>
          </div>
        )}
      </Popover>
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
    </div>
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {locale === "he" ? (
          <>
            {headerControls}
            {allTripsLink}
          </>
        ) : (
          <>
            {allTripsLink}
            {headerControls}
          </>
        )}
      </div>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {displayTitle}
      </h1>

      {tab === "view" ? (
        <div className="mt-6 space-y-6">
          <details className="group rounded-2xl border border-zinc-200/70 bg-white/40 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/30">
            <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 [&::-webkit-details-marker]:hidden [&::marker]:hidden">
              <span>{t("trip.tools")}</span>
              <span aria-hidden className="text-zinc-400 transition-transform group-open:rotate-180 dark:text-zinc-500">
                ▾
              </span>
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
                    <input
                      type="checkbox"
                      checked={simulateLocalDateTimeEnabled}
                      onChange={(e) => setSimulateLocalDateTimeEnabled(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-zinc-300 text-violet-600 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800"
                    />
                    {t("trip.timeSimulationLabel")}
                  </label>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    {simulateLocalDateTimeEnabled
                      ? t("trip.timeSimulationSimulated")
                      : t("trip.timeSimulationLive")}
                  </span>
                </div>
                <input
                  id="trip-local-datetime-sim"
                  type="datetime-local"
                  value={simulatedLocalDateTime}
                  disabled={!simulateLocalDateTimeEnabled}
                  onChange={(e) => setSimulatedLocalDateTime(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>

              {useFirestore ? (
                <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
                      <input
                        type="checkbox"
                        checked={liveLocationSharing}
                        disabled={!canShareLiveLocation}
                        onChange={(e) => {
                          setLiveLocationError(null);
                          setLiveLocationSharing(e.target.checked);
                        }}
                        className="h-3.5 w-3.5 rounded border-zinc-300 text-violet-600 focus:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800"
                      />
                      {t("trip.liveLocationToggle")}
                    </label>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                      {liveLocationSharing
                        ? t("trip.liveLocationStatusSharing")
                        : t("trip.liveLocationStatusOff")}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                    {canShareLiveLocation
                      ? t("trip.liveLocationHelp")
                      : t("trip.liveLocationRequiresTraveler")}
                  </p>
                  {liveLocationError ? (
                    <p className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{liveLocationError}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="md:col-span-2">
                <TripGmailDocumentsPanel
                  tripId={trip.id}
                  user={user}
                  enabled={Boolean(useFirestore && user?.email?.trim())}
                />
              </div>
            </div>
          </details>

          {destinationsMissingMapCoordinates.length > 0 ? (
            <aside
              className="rounded-xl border border-amber-300/60 bg-amber-50/80 px-3 py-2.5 text-xs text-amber-950 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100"
              role="status"
            >
              <p className="font-medium">
                {destinationsMissingMapCoordinates.length === 1
                  ? t("trip.destMissingOne")
                  : t("trip.destMissingMany", { count: destinationsMissingMapCoordinates.length })}{" "}
                <span className="text-amber-900/80 dark:text-amber-100/70">{t("trip.destMissingSuffix")}</span>
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {destinationsMissingMapCoordinates.map((d: Destination) => {
                  const label = (d.title || d.location || t("common.untitled")).trim() || t("common.untitled");
                  return (
                    <li key={d.id}>
                      {canEditTripDestinations ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-white dark:border-amber-600/40 dark:bg-amber-900/30 dark:text-amber-100 dark:hover:bg-amber-900/50"
                          onClick={() => {
                            setDestinationLocationEditSnapshot({ ...d });
                            setDestinationLocationDialogOpen(true);
                          }}
                        >
                          {label} <span aria-hidden>·</span> {t("trip.setLocation")}
                        </button>
                      ) : (
                        <span className="inline-flex rounded-full border border-amber-300/50 bg-amber-100/60 px-2 py-0.5 text-[11px] text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/30 dark:text-amber-100">
                          {label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!canEditTripDestinations && useFirestore ? (
                <p className="mt-2 text-[11px] text-amber-900/80 dark:text-amber-200/80">{t("trip.destReadOnlyHint")}</p>
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
                    const d = trip.destinations.find((x: Destination) => x.id === destinationId);
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
          <div className="flex justify-center">
            <div
              role="tablist"
              aria-label={t("view.itinerary")}
              className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewSubTab === "itinerary"}
                onClick={() => setViewSubTab("itinerary")}
                className={
                  viewSubTab === "itinerary"
                    ? "rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 shadow dark:bg-zinc-800 dark:text-zinc-50"
                    : "rounded-md px-3 py-1.5 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }
              >
                {t("view.itinerary")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewSubTab === "places"}
                onClick={() => setViewSubTab("places")}
                className={
                  viewSubTab === "places"
                    ? "rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 shadow dark:bg-zinc-800 dark:text-zinc-50"
                    : "rounded-md px-3 py-1.5 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }
              >
                {t("view.placesTab", { count: trip.destinations.length })}
              </button>
            </div>
          </div>

          {viewSubTab === "itinerary" ? (
            <>
              {viewPhase === "before_start" ? (
                <TripViewSummary trip={trip} sortedSteps={sortedSteps} nowMs={effectiveNowMs} variant="default" />
              ) : null}
              {viewPhase === "during" ? (
                <TripCurrentStepDashboard trip={trip} focus={viewStepFocus} nowMs={effectiveNowMs} />
              ) : null}
              {viewPhase === "after_end" ? (
                <TripViewSummary trip={trip} sortedSteps={sortedSteps} nowMs={effectiveNowMs} variant="ended" />
              ) : null}
            </>
          ) : (
            <TripDestinationsRoster
              destinations={trip.destinations}
              steps={sortedSteps}
              editable={canEditTripDestinations}
              manageHint={false}
              onSaveDestination={(d) => void handleViewDestinationLocationSave(d)}
              onDeleteDestination={(id) => void handleViewDestinationDelete(id)}
            />
          )}
        </div>
      ) : manageDraft ? (
        <div className="mt-8 pb-40">
          <ManageTripWorkspace
            trip={manageDraft}
            onTripChange={setManageDraftState}
            persistTrip={persistTrip}
            canUploadTripFiles={canUploadTripFiles}
            uploadDisabledHint={uploadDisabledHint}
            saveTarget={saveTargetLabel}
            saveDisabled={useFirestore && (!user || !canManageFirestore)}
            saveError={saveError}
            user={user}
            profilePreferences={profilePreferences}
            dirty={manageDirty}
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

      {showTripAssistant && chatDockVisible ? (
        <TripAssistantChatDock
          trip={dockTrip ?? trip}
          profilePreferences={profilePreferences}
          tripChatMessages={tripChatMessages}
          globalChatMessages={globalChatMessages}
          userEmail={user?.email?.trim() ?? null}
          userDisplayName={user?.displayName?.trim() ?? null}
          isTripOwner={isTripOwner}
          canPersistMemory={Boolean(useFirestore && user?.email?.trim())}
          onAddRecommendations={handleAddAssistantRecommendations}
          openRequest={chatOpenRequest}
          onRequestHide={() => setChatDockVisible(false)}
        />
      ) : null}

      {recsDockVisible ? (
        <TripRecommendationsDock
          trip={dockTrip ?? trip}
          canModify={!useFirestore || canManageFirestore}
          onPersist={persistTrip}
          openRequest={recsOpenRequest}
          onRequestHide={() => setRecsDockVisible(false)}
        />
      ) : null}
    </main>
  );
}
