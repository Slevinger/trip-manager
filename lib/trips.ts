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
import {
  migrateLegacyCombined,
  splitStoredDateAndTime,
} from "@/lib/timeline/dates";

const TRIPS = "trips";
const MEMBERS = "members";

const lastRemoteTrip = new Map<string, Trip>();
const latestKnownTrip = new Map<string, Trip>();
const tripWriters = new Map<
  string,
  { uid: string; email: string; emailLower: string } | null
>();

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

function normalizeHotel(raw: unknown): Trip["steps"][number]["hotels"][number] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ciD = String(r.checkinDate ?? "").trim();
  const ciT = String(r.checkinTime ?? "").trim();
  const coD = String(r.checkoutDate ?? "").trim();
  const coT = String(r.checkoutTime ?? "").trim();
  const ciL = String(r.checkin ?? "").trim();
  const coL = String(r.checkout ?? "").trim();
  const checkin =
    ciD || ciT ? splitStoredDateAndTime(ciD || ciL, ciT) : migrateLegacyCombined(ciL);
  const checkout =
    coD || coT ? splitStoredDateAndTime(coD || coL, coT) : migrateLegacyCombined(coL);
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    checkinDate: checkin.date,
    checkinTime: checkin.time,
    checkoutDate: checkout.date,
    checkoutTime: checkout.time,
    bookingUrl: String(r.bookingUrl ?? ""),
    cost: Number(r.cost ?? 0) || 0,
    notes: String(r.notes ?? ""),
  };
}

function normalizeStep(raw: unknown): Trip["steps"][number] {
  const s = (raw ?? {}) as Record<string, unknown>;
  const coordinates = normalizeCoordinates(s.coordinates, s.lat, s.lng);
  const start = splitStoredDateAndTime(s.startDate, s.startTime);
  const end = splitStoredDateAndTime(s.endDate, s.endTime);
  return {
    id: String(s.id ?? ""),
    order: Number(s.order ?? 0),
    title: String(s.title ?? ""),
    location: String(s.location ?? ""),
    status:
      s.status === "todo" || s.status === "active" || s.status === "done"
        ? s.status
        : "todo",
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    endDateOpen: Boolean(s.endDateOpen ?? true),
    nights: Number(s.nights ?? 0),
    duration: String(s.duration ?? ""),
    transport: String(s.transport ?? ""),
    arrivalSummary: String(s.arrivalSummary ?? ""),
    arrivalOptions: Array.isArray(s.arrivalOptions)
      ? (s.arrivalOptions as Trip["steps"][number]["arrivalOptions"])
      : [],
    hotels: Array.isArray(s.hotels) ? s.hotels.map((h) => normalizeHotel(h)) : [],
    transportCost: Number(s.transportCost ?? 0),
    foodCost: Number(s.foodCost ?? 0),
    activitiesCost: Number(s.activitiesCost ?? 0),
    otherCost: Number(s.otherCost ?? 0),
    notes: String(s.notes ?? ""),
    attachments: normalizeAttachments(s.attachments),
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

function normalizeAttachments(raw: unknown): Trip["steps"][number]["attachments"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const r = (item ?? {}) as Record<string, unknown>;
      const name = String(r.name ?? "").trim();
      const url = String(r.url ?? "").trim();
      const path = String(r.path ?? "").trim();
      if (!name || !url || !path) return null;
      return {
        id: String(r.id ?? ""),
        name,
        url,
        path,
        size: Number(r.size ?? 0) || 0,
        contentType: String(r.contentType ?? ""),
        uploadedAt: String(r.uploadedAt ?? ""),
      };
    })
    .filter((v): v is NonNullable<typeof v> => Boolean(v));
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
  const tsd = String(data.tripStartDate ?? "").trim();
  const tst = String(data.tripStartTime ?? "").trim();
  const leg = String(data.tripStart ?? "").trim();
  const tripTimes =
    tsd || tst ? splitStoredDateAndTime(tsd || leg, tst) : migrateLegacyCombined(leg);
  return {
    ...base,
    id: (data.id as string) || tripId,
    title: String(data.title ?? ""),
    tripStartDate: tripTimes.date,
    tripStartTime: tripTimes.time,
    budget: Number(data.budget ?? 0) || 0,
    managePassword: String(data.managePassword ?? ""),
    ownerUid: String(data.ownerUid ?? ""),
    ownerEmail: String(data.ownerEmail ?? ""),
    ownerEmailLower: String(data.ownerEmailLower ?? ""),
    accessMode: "invited_only",
    tripAttachments: normalizeAttachments(data.tripAttachments),
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
    tripStartDate: trip.tripStartDate,
    tripStartTime: trip.tripStartTime,
    budget: trip.budget,
    managePassword: trip.managePassword,
    ownerUid: trip.ownerUid,
    ownerEmail: trip.ownerEmail,
    ownerEmailLower: trip.ownerEmailLower,
    accessMode: trip.accessMode,
    smartTimeline: trip.smartTimeline,
    autoCurrentByDate: trip.autoCurrentByDate,
    steps: trip.steps,
    updatedAt: serverTimestamp(),
  };
}

export async function createTrip(
  tripId: string,
  owner?: { uid: string; email: string; emailLower: string }
): Promise<void> {
  const ref = tripDocRef(tripId);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  const trip = defaultTrip(tripId);
  const ownerPatch = owner
    ? {
        ownerUid: owner.uid,
        ownerEmail: owner.email,
        ownerEmailLower: owner.emailLower,
      }
    : {};
  await setDoc(ref, {
    ...tripToFirestorePayload(trip),
    ...ownerPatch,
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
  const writer = tripWriters.get(tripId);
  await setDoc(ref, tripToFirestorePayload(trip), { merge: true });
  if (writer) {
    await setDoc(
      doc(ref.firestore, TRIPS, tripId, MEMBERS, writer.uid),
      {
        uid: writer.uid,
        email: writer.email,
        emailLower: writer.emailLower,
        role: "member",
        joinedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
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

export function rememberTripWriter(
  tripId: string,
  writer: { uid: string; email: string; emailLower: string } | null
): void {
  tripWriters.set(tripId, writer);
}
