import type { JsonChangeAction } from "./types";

const MAX_ENTRIES = 100;

export function getHistoryStorageKey(tripId: string) {
  return `tripHistory:${tripId}`;
}

export function loadTripHistory(tripId: string): { past: JsonChangeAction[]; future: JsonChangeAction[] } {
  if (typeof window === "undefined") return { past: [], future: [] };
  try {
    const raw = window.localStorage.getItem(getHistoryStorageKey(tripId));
    if (!raw) return { past: [], future: [] };
    const parsed = JSON.parse(raw) as { past?: JsonChangeAction[]; future?: JsonChangeAction[] };
    return { past: parsed.past ?? [], future: parsed.future ?? [] };
  } catch {
    return { past: [], future: [] };
  }
}

let pending: number | null = null;
let latest: { tripId: string; past: JsonChangeAction[]; future: JsonChangeAction[] } | null = null;

export function persistTripHistoryDebounced(
  tripId: string,
  past: JsonChangeAction[],
  future: JsonChangeAction[],
  delayMs = 150,
) {
  if (typeof window === "undefined") return;

  latest = {
    tripId,
    past: past.slice(-MAX_ENTRIES),
    future: future.slice(0, MAX_ENTRIES),
  };

  if (pending !== null) window.clearTimeout(pending);
  pending = window.setTimeout(() => {
    if (!latest) return;
    try {
      window.localStorage.setItem(
        getHistoryStorageKey(latest.tripId),
        JSON.stringify({ past: latest.past, future: latest.future }),
      );
    } catch {
      // ignore quota/unavailable
    } finally {
      pending = null;
    }
  }, delayMs);
}

/**
 * Removes persisted undo/redo for a trip from `localStorage` and cancels any in-flight
 * debounced write for that trip. Does **not** change Redux `past`/`future` — in-memory
 * undo keeps working until reload (when history is re-hydrated from storage again).
 */
export function clearTripHistoryLocalStorage(tripId: string): void {
  const id = tripId.trim();
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getHistoryStorageKey(id));
  } catch {
    /* ignore */
  }
  if (latest?.tripId === id) {
    if (pending !== null) {
      window.clearTimeout(pending);
      pending = null;
    }
    latest = null;
  }
}

