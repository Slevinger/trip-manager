import {
  doc,
  type FirestoreError,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
  Timestamp,
} from "firebase/firestore";
import { getClientAuth, getDb } from "@/lib/firebase";
import type { StayStep, StepStatus, TransitStep, Trip } from "@/lib/types/trip";
import { defaultTrip } from "@/lib/tripDefaults";
import { applyTransitEndFromArrivals } from "@/lib/timeline/hotelsAndDates";
import {
  formatSpanBetweenStoredParts,
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

function isPermissionDenied(error: unknown): boolean {
  const e = error as FirestoreError | undefined;
  return e?.code === "permission-denied";
}

async function resolveCurrentUserIdentity(): Promise<
  { uid: string; email: string; emailLower: string } | null
> {
  const auth = getClientAuth();
  const u = auth?.currentUser;
  if (!u?.uid) return null;
  const direct = typeof u.email === "string" ? u.email.trim() : "";
  const provider =
    u.providerData
      .map((p) => (typeof p.email === "string" ? p.email.trim() : ""))
      .find((e) => e.length > 0) || "";
  let tokenEmail = "";
  try {
    const token = await u.getIdTokenResult();
    tokenEmail =
      typeof token.claims.email === "string" ? token.claims.email.trim() : "";
  } catch {
    /* ignore transient token-read errors */
  }
  // Firestore rules validate against ID token email; prefer that when present.
  const email = tokenEmail || direct || provider;
  const emailLower = email.toLowerCase();
  if (!emailLower) return null;
  return { uid: u.uid, email, emailLower };
}

/** Firestore create rules require owner fields; bootstrap trips start empty until first save. */
async function withTripOwnerFromAuthIfMissing(trip: Trip): Promise<Trip> {
  const identity = await resolveCurrentUserIdentity();
  if (!identity) {
    throw new Error("AUTH_EMAIL_REQUIRED");
  }
  if (trip.ownerUid.trim() && trip.ownerEmailLower.trim()) {
    if (
      trip.ownerUid === identity.uid &&
      trip.ownerEmailLower.trim() !== identity.emailLower
    ) {
      return {
        ...trip,
        ownerEmail: identity.email,
        ownerEmailLower: identity.emailLower,
      };
    }
    return trip;
  }
  return {
    ...trip,
    ownerUid: identity.uid,
    ownerEmail: identity.email,
    ownerEmailLower: identity.emailLower,
  };
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

function normalizeHotel(raw: unknown): StayStep["hotels"][number] {
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

function normalizeArrivalOptions(raw: unknown): Trip["steps"][number]["arrivalOptions"] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    const st = splitStoredDateAndTime(r.startDate, r.startTime);
    const en = splitStoredDateAndTime(r.endDate, r.endTime);
    const computed = formatSpanBetweenStoredParts(st.date, st.time, en.date, en.time);
    const legacy = String(r.duration ?? "").trim();
    return {
      id: String(r.id ?? ""),
      title: String(r.title ?? ""),
      details: String(r.details ?? ""),
      duration: computed || legacy,
      cost: String(r.cost ?? ""),
      startDate: st.date,
      startTime: st.time,
      endDate: en.date,
      endTime: en.time,
    };
  });
}

function normalizeTransports(raw: unknown): TransitStep["transports"] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    const start = splitStoredDateAndTime(r.startDate, r.startTime);
    const end = splitStoredDateAndTime(r.endDate, r.endTime);
    return {
      id: String(r.id ?? ""),
      title: String(r.title ?? ""),
      from: String(r.from ?? ""),
      to: String(r.to ?? ""),
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time,
      details: String(r.details ?? ""),
      duration: String(r.duration ?? ""),
      cost: String(r.cost ?? ""),
    };
  });
}

function normalizeStep(raw: unknown): Trip["steps"][number] {
  const s = (raw ?? {}) as Record<string, unknown>;
  const coordinates = normalizeCoordinates(s.coordinates, s.lat, s.lng);
  const start = splitStoredDateAndTime(s.startDate, s.startTime);
  const end = splitStoredDateAndTime(s.endDate, s.endTime);
  const status: StepStatus =
    s.status === "todo" || s.status === "active" || s.status === "done"
      ? s.status
      : "todo";
  const shared = {
    id: String(s.id ?? ""),
    order: Number(s.order ?? 0),
    title: String(s.title ?? ""),
    location: String(s.location ?? ""),
    status,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    endDateOpen: Boolean(s.endDateOpen ?? true),
    nights: Number(s.nights ?? 0),
    duration: String(s.duration ?? ""),
    arrivalSummary: String(s.arrivalSummary ?? ""),
    arrivalOptions: normalizeArrivalOptions(s.arrivalOptions),
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

  const hotels = Array.isArray(s.hotels) ? s.hotels.map((h) => normalizeHotel(h)) : [];
  const transports = normalizeTransports(s.transports);
  const type = s.type === "stay" ? "stay" : "transit";

  if (type === "stay") return { ...shared, type, hotels };
  const fromStayStepId = String(s.fromStayStepId ?? "").trim();
  const toStayStepId = String(s.toStayStepId ?? "").trim();
  const transitTypeRaw = String(s.transitType ?? "").trim();
  const transitType =
    transitTypeRaw === "airplane" ||
    transitTypeRaw === "minivan" ||
    transitTypeRaw === "taxi" ||
    transitTypeRaw === "ferry" ||
    transitTypeRaw === "speedboat"
      ? transitTypeRaw
      : undefined;
  const rawStep = s as Record<string, unknown>;
  const hasDurationKeys =
    "transitDurationDays" in rawStep ||
    "transitDurationHours" in rawStep ||
    "transitDurationMinutes" in rawStep;
  const transit: TransitStep = {
    ...shared,
    type,
    transports,
    endDateOpen: false,
    nights: 0,
    transitEndManual: Boolean(s.transitEndManual),
    ...(transitType ? { transitType } : {}),
    ...(fromStayStepId ? { fromStayStepId } : {}),
    ...(toStayStepId ? { toStayStepId } : {}),
    ...(hasDurationKeys
      ? {
          transitDurationDays: Number(s.transitDurationDays ?? 0) || 0,
          transitDurationHours: Number(s.transitDurationHours ?? 0) || 0,
          transitDurationMinutes: Number(s.transitDurationMinutes ?? 0) || 0,
        }
      : {}),
  };
  return applyTransitEndFromArrivals(transit);
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
  return stripUndefinedDeep({
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
  });
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, stripUndefinedDeep(v)]);
    return Object.fromEntries(entries) as T;
  }
  return value;
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
  const raw = pendingTripWrites.get(tripId);
  if (!raw) return;
  pendingTripWrites.delete(tripId);
  const trip = await withTripOwnerFromAuthIfMissing(raw);
  rememberTripSnapshot(trip);
  const ref = tripDocRef(tripId);
  const writer = tripWriters.get(tripId);
  const identity = await resolveCurrentUserIdentity();
  const u = identity ? { uid: identity.uid, email: identity.email } : null;
  const canWriteOwnerMember =
    u?.uid &&
    trip.ownerUid === u.uid &&
    trip.ownerEmailLower.trim();
  const writeOwnerMember = async () => {
    if (!canWriteOwnerMember) return;
    const memberEmail =
      trip.ownerEmail.trim() || u.email?.trim() || trip.ownerEmailLower;
    await setDoc(
      doc(ref.firestore, TRIPS, tripId, MEMBERS, u.uid),
      {
        uid: u.uid,
        email: memberEmail,
        emailLower: trip.ownerEmailLower.trim(),
        role: "member",
        joinedAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  try {
    await setDoc(ref, tripToFirestorePayload(trip), { merge: true });
  } catch (error) {
    // Existing unclaimed docs can reject trip update until owner membership exists.
    if (!isPermissionDenied(error)) throw error;
    await writeOwnerMember();
    await setDoc(ref, tripToFirestorePayload(trip), { merge: true });
  }

  await writeOwnerMember();

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

async function saveTripViaApi(trip: Trip): Promise<void> {
  const auth = getClientAuth();
  const u = auth?.currentUser;
  if (!u) {
    throw new Error("AUTH_REQUIRED");
  }
  const token = await u.getIdToken();
  const res = await fetch(`/api/trips/${encodeURIComponent(trip.id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ trip }),
  });
  if (!res.ok) {
    let details = "";
    try {
      const json = (await res.json()) as { error?: string };
      details = json?.error ? ` (${json.error})` : "";
    } catch {
      /* ignore parse errors */
    }
    throw new Error(`save_failed${details}`);
  }
}

/** Skip debounce and write this trip to Firestore now (explicit Save). */
export async function flushTripSaveNow(trip: Trip): Promise<void> {
  const tripId = trip.id;
  const existing = debounceTimers.get(tripId);
  if (existing) {
    clearTimeout(existing);
    debounceTimers.delete(tripId);
  }
  const ready = await withTripOwnerFromAuthIfMissing({ ...trip, id: tripId });
  rememberTripSnapshot(ready);
  pendingTripWrites.set(tripId, ready);
  try {
    await flushTripWrite(tripId);
  } catch (error) {
    if (!isPermissionDenied(error)) throw error;
    await saveTripViaApi(ready);
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

/** Merge patch into the latest remembered trip without scheduling a save. */
export function mergeLatestTrip(tripId: string, patch: Partial<Trip>): Trip {
  const base =
    latestKnownTrip.get(tripId) ??
    lastRemoteTrip.get(tripId) ??
    defaultTrip(tripId);
  return mergeTrip({ ...base, id: tripId }, patch);
}

/** Merge patch into the latest remembered trip, then debounced save. */
export function updateTrip(tripId: string, patch: Partial<Trip>): Trip {
  const next = mergeLatestTrip(tripId, patch);
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
