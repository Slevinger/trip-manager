import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
  Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type { Trip } from "@/lib/types/trip";
import { defaultTrip } from "@/lib/tripDefaults";

const TRIPS = "trips";

const lastRemoteTrip = new Map<string, Trip>();
const latestKnownTrip = new Map<string, Trip>();

function tripDocRef(tripId: string) {
  const db = getDb();
  if (!db) throw new Error("Firestore is not configured");
  return doc(db, TRIPS, tripId);
}

export function getTripRef(tripId: string) {
  return tripDocRef(tripId);
}

function tsToIso(v: unknown): string {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof v === "string") return v;
  if (typeof v === "number") return new Date(v).toISOString();
  return new Date().toISOString();
}

function normalizeStep(raw: unknown): Trip["steps"][number] {
  const s = (raw ?? {}) as Record<string, unknown>;
  const coordinates = normalizeCoordinates(s.coordinates, s.lat, s.lng);
  return {
    id: String(s.id ?? ""),
    order: Number(s.order ?? 0),
    title: String(s.title ?? ""),
    location: String(s.location ?? ""),
    status:
      s.status === "todo" || s.status === "active" || s.status === "done"
        ? s.status
        : "todo",
    startDate: String(s.startDate ?? ""),
    endDate: String(s.endDate ?? ""),
    endDateOpen: Boolean(s.endDateOpen ?? true),
    nights: Number(s.nights ?? 0),
    duration: String(s.duration ?? ""),
    transport: String(s.transport ?? ""),
    arrivalSummary: String(s.arrivalSummary ?? ""),
    arrivalOptions: Array.isArray(s.arrivalOptions)
      ? (s.arrivalOptions as Trip["steps"][number]["arrivalOptions"])
      : [],
    hotels: Array.isArray(s.hotels) ? (s.hotels as Trip["steps"][number]["hotels"]) : [],
    transportCost: Number(s.transportCost ?? 0),
    foodCost: Number(s.foodCost ?? 0),
    activitiesCost: Number(s.activitiesCost ?? 0),
    otherCost: Number(s.otherCost ?? 0),
    notes: String(s.notes ?? ""),
    ...(coordinates ? { coordinates } : {}),
    ...(() => {
      const mx = numOrUndef(s.mapX ?? s.x);
      const my = numOrUndef(s.mapY ?? s.y);
      const o: { mapX?: number; mapY?: number } = {};
      if (mx !== undefined) o.mapX = mx;
      if (my !== undefined) o.mapY = my;
      return o;
    })(),
  };
}

function normalizeCoordinates(
  value: unknown,
  fallbackLat?: unknown,
  fallbackLng?: unknown
): { lat: number; lng: number } | null {
  const fromObject =
    value && typeof value === "object"
      ? (value as { lat?: unknown; lng?: unknown })
      : null;
  const lat = numOrUndef(fromObject?.lat ?? fallbackLat);
  const lng = numOrUndef(fromObject?.lng ?? fallbackLng);
  if (lat === undefined || lng === undefined) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function numOrUndef(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function normalizeTripFromFirestore(
  tripId: string,
  data: Record<string, unknown> | undefined
): Trip {
  const base = defaultTrip(tripId);
  if (!data) return base;
  const stepsRaw = Array.isArray(data.steps) ? data.steps : [];
  return {
    ...base,
    ...data,
    id: (data.id as string) || tripId,
    title: String(data.title ?? ""),
    tripStart: String(data.tripStart ?? ""),
    smartTimeline: Boolean(data.smartTimeline ?? true),
    autoCurrentByDate: Boolean(data.autoCurrentByDate ?? true),
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
    steps: stepsRaw.map(normalizeStep),
  };
}

export function tripToFirestorePayload(trip: Trip): Record<string, unknown> {
  return {
    id: trip.id,
    title: trip.title,
    tripStart: trip.tripStart,
    smartTimeline: trip.smartTimeline,
    autoCurrentByDate: trip.autoCurrentByDate,
    steps: trip.steps,
    updatedAt: serverTimestamp(),
  };
}

export async function createTrip(tripId: string): Promise<void> {
  const ref = tripDocRef(tripId);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  const trip = defaultTrip(tripId);
  await setDoc(ref, {
    ...tripToFirestorePayload(trip),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Keep latest trip snapshot for debounced partial writes. */
export function rememberTripSnapshot(trip: Trip): void {
  latestKnownTrip.set(trip.id, trip);
}

export function subscribeToTrip(
  tripId: string,
  callback: (trip: Trip | null, error?: Error) => void
): Unsubscribe {
  const ref = tripDocRef(tripId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      const trip = normalizeTripFromFirestore(
        tripId,
        snap.data() as Record<string, unknown>
      );
      lastRemoteTrip.set(tripId, trip);
      rememberTripSnapshot(trip);
      callback(trip);
    },
    (error) => {
      callback(null, error instanceof Error ? error : new Error(String(error)));
    }
  );
}

const DEBOUNCE_MS = 450;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingTripWrites = new Map<string, Trip>();

function scheduleFlush(tripId: string) {
  const existing = debounceTimers.get(tripId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    debounceTimers.delete(tripId);
    void flushTripWrite(tripId);
  }, DEBOUNCE_MS);
  debounceTimers.set(tripId, timer);
}

async function flushTripWrite(tripId: string) {
  const trip = pendingTripWrites.get(tripId);
  if (!trip) return;
  pendingTripWrites.delete(tripId);
  const ref = tripDocRef(tripId);
  await setDoc(ref, tripToFirestorePayload(trip), { merge: true });
}

/** Debounced full-document persist (optimistic UI should update before this). */
export function saveTrip(trip: Trip): void {
  rememberTripSnapshot(trip);
  pendingTripWrites.set(trip.id, trip);
  scheduleFlush(trip.id);
}

export function mergeTrip(current: Trip, patch: Partial<Trip>): Trip {
  return {
    ...current,
    ...patch,
    steps: patch.steps ?? current.steps,
  };
}

/** Merge patch into the latest remembered trip, then debounced save. */
export function updateTrip(tripId: string, patch: Partial<Trip>): Trip {
  const base =
    latestKnownTrip.get(tripId) ??
    lastRemoteTrip.get(tripId) ??
    defaultTrip(tripId);
  const next = mergeTrip({ ...base, id: tripId }, patch);
  saveTrip(next);
  return next;
}

export function cancelPendingTripSave(tripId: string): void {
  const t = debounceTimers.get(tripId);
  if (t) clearTimeout(t);
  debounceTimers.delete(tripId);
  pendingTripWrites.delete(tripId);
}
