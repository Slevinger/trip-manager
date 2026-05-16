import {
  arrayUnion,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type DocumentData,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { getIdTokenResult, type User } from "firebase/auth";
import { migrateTripToDestinationRegistry } from "@/lib/tripDestinationRegistry";
import { logCaughtException } from "@/lib/logCaughtException";
import type { Trip, TripLiveLocation } from "@/lib/types/trip";

/** Top-level collection for canonical (v2) trip documents. */
export const CANONICAL_TRIPS_COLLECTION = "canonicalTrips";

export const OWNER_UID = "ownerUid";
const OWNER_EMAIL_LOWER = "ownerEmailLower";
/** Lowercased emails: trip owner + travelers + viewers; used in rules + invites. */
export const PARTICIPANT_EMAILS_LOWER = "participantEmailsLower";
/**
 * Firebase Auth uids allowed to open the trip. Used for home-list queries:
 * `where(participantUids, array-contains, request.auth.uid)` is what Firestore's
 * rule analyzer accepts reliably (email array-contains + JWT email often fails).
 */
export const PARTICIPANT_UIDS = "participantUids";

export type CanonicalTripFirestoreDoc = Trip & {
  [OWNER_UID]: string;
  [OWNER_EMAIL_LOWER]?: string;
  [PARTICIPANT_EMAILS_LOWER]: string[];
  [PARTICIPANT_UIDS]: string[];
};

function emailLower(user: User): string {
  return (user.email ?? "").trim().toLowerCase();
}

export function tripDocRef(db: Firestore, tripId: string) {
  return doc(db, CANONICAL_TRIPS_COLLECTION, tripId);
}

function coerceFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isoFromFirestoreInstant(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const o = raw as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof o.toDate === "function") {
      try {
        return o.toDate().toISOString();
      } catch (e) {
        logCaughtException(e, "canonicalTripsFirestore/isoFromFirestoreInstant/toDate");
      }
    }
    if (typeof o.seconds === "number") {
      const ns = typeof o.nanoseconds === "number" ? o.nanoseconds : 0;
      return new Date(o.seconds * 1000 + ns / 1e6).toISOString();
    }
  }
  return new Date(0).toISOString();
}

/**
 * Firestore update paths treat `.` as nesting. Writing `liveLocations.${email}` split
 * `user.name@gmail.com` into nested maps instead of one key. Walk the tree and fold leaves
 * (lat/lon payloads) into a flat map keyed by joining path segments — recovering the email.
 */
function flattenLiveLocationsForRead(raw: unknown): Record<string, TripLiveLocation> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, TripLiveLocation> = {};

  function isLeaf(o: Record<string, unknown>): boolean {
    const lat =
      coerceFiniteNumber(o.lat) ??
      coerceFiniteNumber(o.latitude);
    const lon =
      coerceFiniteNumber(o.lon) ??
      coerceFiniteNumber(o.lng) ??
      coerceFiniteNumber(o.longitude);
    return lat != null && lon != null;
  }

  function walk(node: unknown, segments: string[]): void {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const o = node as Record<string, unknown>;
    if (isLeaf(o)) {
      if (segments.length === 0) return;
      const key = segments.join(".");
      const lat =
        coerceFiniteNumber(o.lat) ??
        coerceFiniteNumber(o.latitude) ??
        0;
      const lon =
        coerceFiniteNumber(o.lon) ??
        coerceFiniteNumber(o.lng) ??
        coerceFiniteNumber(o.longitude) ??
        0;
      const nameRaw = o.name;
      const name =
        (typeof nameRaw === "string" ? nameRaw : String(nameRaw ?? "")).trim() || "Traveler";
      out[key] = {
        name,
        lat,
        lon,
        updatedAt: isoFromFirestoreInstant(o.updatedAt),
      };
      return;
    }
    for (const [k, v] of Object.entries(o)) {
      walk(v, [...segments, k]);
    }
  }

  walk(raw, []);
  return Object.keys(out).length > 0 ? out : undefined;
}

function stripMeta(data: DocumentData): Trip {
  const {
    [OWNER_UID]: _u,
    [OWNER_EMAIL_LOWER]: _e,
    [PARTICIPANT_EMAILS_LOWER]: _p,
    [PARTICIPANT_UIDS]: _pu,
    ...rest
  } = data as Record<string, unknown>;
  const next = { ...rest };
  if (next.liveLocations != null) {
    const flat = flattenLiveLocationsForRead(next.liveLocations);
    if (flat) next.liveLocations = flat;
  }
  return migrateTripToDestinationRegistry(next);
}

/** Plain-object Firestore payload → client {@link Trip} (server Admin SDK or tests). */
export function canonicalFirestoreDataToTrip(data: Record<string, unknown>): Trip {
  return stripMeta(data as DocumentData);
}

/** Same visibility as home / trip snapshot: owner, participant uid/email lists, or nested party emails. */
export function canonicalTripDocReadableByUser(
  uid: string,
  viewerEmailLower: string,
  data: Record<string, unknown>
): boolean {
  if (data[OWNER_UID] === uid) return true;
  const uidList = data[PARTICIPANT_UIDS];
  if (Array.isArray(uidList) && uidList.some((x) => x === uid)) return true;
  const em = viewerEmailLower.trim().toLowerCase();
  if (em) {
    const list = data[PARTICIPANT_EMAILS_LOWER];
    if (Array.isArray(list) && list.some((x) => typeof x === "string" && x === em)) return true;
  }
  const ownerEl = String(data[OWNER_EMAIL_LOWER] ?? "").trim().toLowerCase();
  const trip = canonicalFirestoreDataToTrip(data);
  return em ? participantEmailsLowerFromTrip(trip, ownerEl).includes(em) : false;
}

/**
 * Same notion as Firestore `request.auth.token.firebase.sign_in_provider == 'google.com'`
 * (uses the ID token used for Firestore requests).
 */
export async function sessionIsGoogleSignIn(user: User): Promise<boolean> {
  try {
    const { signInProvider } = await getIdTokenResult(user, false);
    return signInProvider === "google.com";
  } catch {
    return false;
  }
}

/**
 * @deprecated Use {@link sessionIsGoogleSignIn} and **await** it. Alias kept so older dev bundles
 * or mixed imports don’t throw `ReferenceError` / missing export.
 */
export const isSignInFromGoogle = sessionIsGoogleSignIn;

/** Reads `email` or legacy `Email` from a traveler/viewer map (Firestore is case-sensitive on keys). */
function partyRowEmailLower(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  const o = row as Record<string, unknown>;
  const v = o.email ?? o.Email;
  return (typeof v === "string" ? v : "").trim().toLowerCase();
}

/** Emails allowed to read the trip (Firestore rules); includes owner + traveler + viewer rows. */
export function participantEmailsLowerFromTrip(trip: Trip, ownerEmailLower: string): string[] {
  const s = new Set<string>();
  const o = ownerEmailLower.trim().toLowerCase();
  if (o) s.add(o);
  for (const tr of trip.travelers) {
    const e = partyRowEmailLower(tr);
    if (e) s.add(e);
  }
  for (const vw of trip.viewers ?? []) {
    const e = partyRowEmailLower(vw);
    if (e) s.add(e);
  }
  return Array.from(s).sort();
}

/** Firestore rejects `undefined` anywhere in document data (including nested maps/arrays). */
function pruneUndefinedForFirestore(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => pruneUndefinedForFirestore(item))
      .filter((item) => item !== undefined);
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const next = pruneUndefinedForFirestore(v);
    if (next === undefined) continue;
    out[k] = next;
  }
  return out;
}

function normalizeParticipantUidList(
  existing: unknown,
  ownerUid: string,
  editorUid: string
): string[] {
  const s = new Set<string>();
  if (ownerUid.trim()) s.add(ownerUid.trim());
  if (editorUid.trim()) s.add(editorUid.trim());
  if (Array.isArray(existing)) {
    for (const x of existing) {
      if (typeof x === "string" && x.trim()) s.add(x.trim());
    }
  }
  return Array.from(s).sort();
}

function buildCanonicalTripFirestoreDoc(
  trip: Trip,
  editor: User,
  ownerUid: string,
  existingParticipantUids?: unknown
): CanonicalTripFirestoreDoc {
  const editorEl = emailLower(editor);
  const raw: CanonicalTripFirestoreDoc = {
    ...trip,
    [OWNER_UID]: ownerUid,
    ...(editorEl ? { [OWNER_EMAIL_LOWER]: editorEl } : {}),
    [PARTICIPANT_EMAILS_LOWER]: participantEmailsLowerFromTrip(trip, editorEl),
    [PARTICIPANT_UIDS]: normalizeParticipantUidList(
      existingParticipantUids,
      ownerUid,
      editor.uid
    ),
  };
  return pruneUndefinedForFirestore(raw) as CanonicalTripFirestoreDoc;
}

/** @deprecated Prefer {@link saveCanonicalTrip}; kept for scripts/tests that create a doc in one shot. */
export function tripToFirestoreDoc(trip: Trip, user: User): CanonicalTripFirestoreDoc {
  return buildCanonicalTripFirestoreDoc(trip, user, user.uid);
}

function snapshotReadableByUser(user: User, data: DocumentData): boolean {
  return canonicalTripDocReadableByUser(user.uid, emailLower(user), data as Record<string, unknown>);
}

/** Owner uid match, or Google email listed on a {@link Trip.travelers} row (not view-only viewers). */
export function userCanManageCanonicalTripDoc(user: User, data: DocumentData): boolean {
  if (data[OWNER_UID] === user.uid) return true;
  const em = emailLower(user);
  if (!em) return false;
  const trip = stripMeta(data) as Trip;
  for (const tr of trip.travelers) {
    if (partyRowEmailLower(tr) === em) return true;
  }
  return false;
}

export type CanonicalTripSubscribeAccess = {
  /** May save in Manage (owner or listed traveler); delete trip remains owner-only in app + rules. */
  canManageFirestore: boolean;
  /** True only when the signed-in user is the trip's `ownerUid`. */
  isOwner: boolean;
};

export function subscribeCanonicalTrip(
  db: Firestore,
  tripId: string,
  user: User,
  onTrip: (trip: Trip | null, access?: CanonicalTripSubscribeAccess) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const ref = tripDocRef(db, tripId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onTrip(null);
        return;
      }
      const data = snap.data();
      if (!snapshotReadableByUser(user, data)) {
        onTrip(null);
        return;
      }
      const ownerUidRaw = (data as Record<string, unknown>)[OWNER_UID];
      const isOwner = typeof ownerUidRaw === "string" && ownerUidRaw.length > 0 && ownerUidRaw === user.uid;
      onTrip(stripMeta(data), {
        canManageFirestore: userCanManageCanonicalTripDoc(user, data),
        isOwner,
      });
    },
    (err) => onError?.(err)
  );
}

export async function saveCanonicalTrip(
  db: Firestore,
  trip: Trip,
  user: User
): Promise<void> {
  const ref = tripDocRef(db, trip.id);
  let existing: DocumentData | null = null;
  try {
    const snap = await getDoc(ref);
    existing = snap.exists() ? snap.data() : null;
  } catch (err) {
    const code = firestoreErrCode(err);
    if (!code.includes("permission-denied")) throw err;
    // Some rulesets deny reading a non-existent doc path; allow create attempt to proceed.
    existing = null;
  }
  const ownerUid = existing ? String(existing[OWNER_UID] ?? "") : user.uid;
  if (existing && !userCanManageCanonicalTripDoc(user, existing)) {
    throw new Error("Only the trip owner or a listed traveler can save changes.");
  }
  const existingUids = existing ? existing[PARTICIPANT_UIDS] : undefined;
  await setDoc(
    ref,
    buildCanonicalTripFirestoreDoc(trip, user, ownerUid || user.uid, existingUids)
  );
}

/**
 * Ensures `participantUids` includes the signed-in user's uid (merge, idempotent).
 * Call after a successful single-trip read so travelers/viewers who open a shared
 * link once will appear on the home list (`array-contains` on uid).
 */
export async function ensureCanonicalTripListsMyUid(
  db: Firestore,
  tripId: string,
  user: User
): Promise<void> {
  const uid = user.uid?.trim();
  const tid = tripId.trim();
  if (!uid || !tid) return;
  await setDoc(
    tripDocRef(db, tid),
    { [PARTICIPANT_UIDS]: arrayUnion(uid) },
    { merge: true }
  );
}

export async function deleteCanonicalTrip(
  db: Firestore,
  tripId: string,
  user: User
): Promise<void> {
  const ref = tripDocRef(db, tripId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  if (snap.data()?.[OWNER_UID] !== user.uid) return;
  await deleteDoc(ref);
}

function sortTripsByUpdatedDesc(trips: Trip[]): void {
  trips.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

function firestoreErrCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code?: string }).code ?? "")
    : "";
}

/**
 * Lists trips the user may open via **GET /api/canonical-trips/my** (Admin SDK + ID token).
 * Client Firestore `list` on `canonicalTrips` is not used (rules can deny collection queries).
 *
 * @param pollMs Refetch interval in ms. **`0` (default) = one fetch on subscribe** (e.g. app open or
 * explicit resubscribe after `refresh()`). Pass a positive value to poll on an interval; when
 * polling, refetches are skipped while the tab is hidden and resume when it becomes visible.
 */
export function subscribeMyCanonicalTrips(
  user: User,
  onTrips: (trips: Trip[]) => void,
  onError?: (e: Error) => void,
  pollMs: number = 0
): Unsubscribe {
  let cancelled = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function tick() {
    if (cancelled) return;
    if (
      pollMs > 0 &&
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/canonical-trips/my", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      let body: { trips?: Trip[]; error?: string } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch (e) {
        logCaughtException(e, "canonicalTripsFirestore/subscribeMyCanonicalTrips/parseResponseJson");
      }
      if (!res.ok) {
        const msg =
          typeof body.error === "string" && body.error.trim()
            ? body.error
            : res.statusText || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      if (!cancelled) onTrips(Array.isArray(body.trips) ? body.trips : []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[canonicalTrips] /api/canonical-trips/my failed.", {
        message: err instanceof Error ? err.message : String(err),
      });
      if (!cancelled) onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  let onVisibility: (() => void) | undefined;
  if (pollMs > 0 && typeof document !== "undefined") {
    onVisibility = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
  }

  void tick();
  if (pollMs > 0) timer = setInterval(() => void tick(), pollMs);
  return () => {
    cancelled = true;
    if (timer) clearInterval(timer);
    if (typeof document !== "undefined" && onVisibility) {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

