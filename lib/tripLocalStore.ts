import { logCaughtException } from "@/lib/logCaughtException";
import { migrateTripToDestinationRegistry } from "@/lib/tripDestinationRegistry";
import type { Trip } from "@/lib/types/trip";
import { sampleTrip } from "@/lib/sampleTrip";

const STORAGE_KEY = "planner-next:v1";

type TripStore = {
  trips: Record<string, Trip>;
  /** Newest first */
  order: string[];
};

function emptyStore(): TripStore {
  return { trips: {}, order: [] };
}

export function loadStore(): TripStore {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as TripStore;
    if (!parsed || typeof parsed !== "object" || !parsed.trips || !Array.isArray(parsed.order)) {
      return emptyStore();
    }
    return parsed;
  } catch (e) {
    logCaughtException(e, "tripLocalStore/loadStore");
    return emptyStore();
  }
}

function saveStore(store: TripStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    logCaughtException(e, "tripLocalStore/saveStore");
  }
}

/** Seed sample trip once if the store is empty (first visit). */
export function ensureSeedTrip(): void {
  const s = loadStore();
  if (s.order.length > 0) return;
  const trip = { ...sampleTrip, id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
  s.trips[trip.id] = trip;
  s.order = [trip.id];
  saveStore(s);
}

export function listTrips(): Trip[] {
  const s = loadStore();
  return s.order.map((id) => s.trips[id]).filter(Boolean);
}

export function getTrip(id: string): Trip | null {
  const raw = loadStore().trips[id];
  return raw ? migrateTripToDestinationRegistry(raw) : null;
}

export function putTrip(trip: Trip): void {
  const s = loadStore();
  const next: Trip = { ...trip, updatedAt: new Date().toISOString() };
  s.trips[next.id] = next;
  if (!s.order.includes(next.id)) {
    s.order = [next.id, ...s.order];
  }
  saveStore(s);
}

export function deleteTrip(id: string): void {
  const s = loadStore();
  delete s.trips[id];
  s.order = s.order.filter((x) => x !== id);
  saveStore(s);
}

export function createNewTrip(): Trip {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return {
    id,
    title: "New trip",
    description: "",
    currency: "USD",
    travelers: [{ id: crypto.randomUUID(), name: "You", role: "owner" }],
    viewers: [],
    startDate: now,
    endDate: now,
    steps: [],
    destinations: [],
    tasks: [],
    documents: [],
    warnings: [],
    createdAt: now,
    updatedAt: now,
  };
}
