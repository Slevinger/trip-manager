import type { Middleware } from "@reduxjs/toolkit";
import { diffJson, invertDiff, tripDiffOptions } from "@/lib/stateDiff";
import { hydrateHistory, pushHistory, setActiveTripId } from "./tripSlice";
import { loadTripHistory, persistTripHistoryDebounced } from "./historyPersistence";
import type { JsonChangeAction } from "./types";
import type { TripState } from "./tripSlice";

type HistoryRootState = { trip: TripState };

type PendingDebounce = {
  tripId: string;
  scope: "draft";
  before: any;
  after: any;
  lastActionType: string;
  timeoutId: number;
};

const DRAFT_DEBOUNCE_MS = 350;
let pendingDraft: PendingDebounce | null = null;

function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const historyMiddleware: Middleware<{}, HistoryRootState> = (api) => (next) => (action) => {
  const prevState = api.getState();

  // Skip recording for initialization and explicit skip meta.
  const meta = (action as any)?.meta;
  const skip = meta?.history === "skip";
  const type = (action as any)?.type as string | undefined;

  const result = next(action);

  if (!type || skip) return result;
  if (type === "trip/undo" || type === "trip/redo" || type === "trip/pushHistory" || type === "trip/hydrateHistory")
    return result;

  const nextState = api.getState();

  const activeTripId = nextState.trip.activeTripId;
  const prevTrip = prevState.trip.trip;
  const nextTrip = nextState.trip.trip;
  const prevDraft = prevState.trip.draft;
  const nextDraft = nextState.trip.draft;

  // Opportunistically set activeTripId from trip payload if not set yet.
  if (!activeTripId && (nextTrip?.id || nextDraft?.id)) {
    api.dispatch(setActiveTripId(nextTrip?.id ?? nextDraft?.id ?? null));
  }

  // Hydrate history once when a trip becomes active.
  const nowActive = api.getState().trip.activeTripId;
  if (nowActive && prevState.trip.activeTripId !== nowActive) {
    api.dispatch({ type: hydrateHistory.type, payload: loadTripHistory(nowActive), meta: { history: "skip" } });
  }

  const computeAndPush = (
    scope: "trip" | "draft",
    before: any,
    after: any,
    actionType: string,
  ) => {
    if (!before || !after) return;
    const forward = diffJson(before as any, after as any, tripDiffOptions);
    if (!forward.length) return;
    const reverse = invertDiff(forward);

    const entry: JsonChangeAction = {
      id: randomId(),
      ts: Date.now(),
      actionType,
      scope,
      forward,
      reverse,
    };
    api.dispatch({ type: pushHistory.type, payload: entry, meta: { history: "skip" } });

    const s = api.getState();
    if (s.trip.activeTripId) {
      persistTripHistoryDebounced(s.trip.activeTripId, s.trip.past, s.trip.future);
    }
  };

  const flushPendingDraft = () => {
    if (!pendingDraft) return;
    const { before, after, lastActionType } = pendingDraft;
    pendingDraft = null;
    computeAndPush("draft", before, after, `${lastActionType} (debounced)`);
  };

  // Record trip changes
  if (prevTrip !== nextTrip) {
    // If the canonical trip changes, flush any pending draft burst first so undo order is intuitive.
    flushPendingDraft();
    computeAndPush("trip", prevTrip, nextTrip, type);
  }
  // Record draft changes
  if (prevDraft !== nextDraft) {
    const tripIdForDraft = nextState.trip.activeTripId ?? nextDraft?.id ?? nextTrip?.id;
    if (!tripIdForDraft || typeof window === "undefined") {
      computeAndPush("draft", prevDraft, nextDraft, type);
      return result;
    }

    // Debounce draft changes: coalesce rapid typing into one history entry.
    if (pendingDraft && pendingDraft.tripId === tripIdForDraft) {
      window.clearTimeout(pendingDraft.timeoutId);
      pendingDraft.after = nextDraft;
      pendingDraft.lastActionType = type;
      pendingDraft.timeoutId = window.setTimeout(flushPendingDraft, DRAFT_DEBOUNCE_MS);
    } else {
      if (pendingDraft) {
        window.clearTimeout(pendingDraft.timeoutId);
        flushPendingDraft();
      }
      pendingDraft = {
        tripId: tripIdForDraft,
        scope: "draft",
        before: prevDraft,
        after: nextDraft,
        lastActionType: type,
        timeoutId: window.setTimeout(flushPendingDraft, DRAFT_DEBOUNCE_MS),
      };
    }
  }

  return result;
};

