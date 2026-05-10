/**
 * Per-trip chat transcript persisted to `localStorage`.
 *
 * Acts as the always-on fallback when Firestore-backed persistence is unavailable
 * (local-only trip, signed-out viewer, transient cloud failure). The cloud paths
 * (`users/.../memory`, `trips/{id}/assistantThread`) remain authoritative when
 * present; this store only seeds the dock so a refresh never erases the
 * conversation that produced the user's recommendations.
 */

import type { TripChatMessage } from "@/lib/types/user";

const STORAGE_KEY = "planner-next:tripChat:v1";
/** Hard cap per trip — keeps the JSON blob bounded even after long sessions. */
const PER_TRIP_LIMIT = 200;

type Store = Record<string, TripChatMessage[]>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota — drop silently; cloud writes (when configured) remain the source of truth */
  }
}

function sanitizeMessage(m: TripChatMessage): TripChatMessage | null {
  if (!m || typeof m !== "object") return null;
  if (typeof m.tripId !== "string" || !m.tripId.trim()) return null;
  if (typeof m.content !== "string" || !m.content.trim()) return null;
  if (m.from !== "agent" && (typeof m.from !== "string" || !m.from.trim())) return null;
  const ts = typeof m.timeStamp === "string" && m.timeStamp.trim()
    ? m.timeStamp
    : new Date().toISOString();
  return { ...m, timeStamp: ts };
}

export function loadTripChatLocal(tripId: string): TripChatMessage[] {
  const id = tripId.trim();
  if (!id) return [];
  const list = readStore()[id];
  if (!Array.isArray(list)) return [];
  return list
    .map(sanitizeMessage)
    .filter((m): m is TripChatMessage => m !== null && m.tripId === id);
}

export function appendTripChatLocal(tripId: string, messages: TripChatMessage[]): void {
  const id = tripId.trim();
  if (!id) return;
  const additions = messages
    .map(sanitizeMessage)
    .filter((m): m is TripChatMessage => m !== null && m.tripId === id);
  if (additions.length === 0) return;
  const store = readStore();
  const existing = Array.isArray(store[id]) ? store[id] : [];
  const merged = [...existing, ...additions].slice(-PER_TRIP_LIMIT);
  store[id] = merged;
  writeStore(store);
}

export function clearTripChatLocal(tripId: string): void {
  const id = tripId.trim();
  if (!id) return;
  const store = readStore();
  if (!(id in store)) return;
  delete store[id];
  writeStore(store);
}
