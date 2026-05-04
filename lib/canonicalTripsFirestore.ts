import {
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  or,
  query,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Firestore,
  type QuerySnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { getIdTokenResult, type User } from "firebase/auth";
import { migrateTripToDestinationRegistry } from "@/lib/tripDestinationRegistry";
import type { Trip, TripLiveLocation } from "@/lib/types/trip";

/** Top-level collection for canonical (v2) trip documents. */
export const CANONICAL_TRIPS_COLLECTION = "canonicalTrips";

const OWNER_UID = "ownerUid";
const OWNER_EMAIL_LOWER = "ownerEmailLower";
/** Lowercased emails: trip owner + travelers + viewers; used in rules + shared-trip listing. */
export const PARTICIPANT_EMAILS_LOWER = "participantEmailsLower";

export type CanonicalTripFirestoreDoc = Trip & {
  [OWNER_UID]: string;
  [OWNER_EMAIL_LOWER]?: string;
  [PARTICIPANT_EMAILS_LOWER]: string[];
};

function emailLower(user: User): string {
  return (user.email ?? "").trim().toLowerCase();
}

export function tripDocRef(db: Firestore, tripId: string) {
  return doc(db, CANONICAL_TRIPS_COLLECTION, tripId);
}

function stripMeta(data: DocumentData): Trip {
  const {
    [OWNER_UID]: _u,
    [OWNER_EMAIL_LOWER]: _e,
    [PARTICIPANT_EMAILS_LOWER]: _p,
    ...rest
  } = data as Record<string, unknown>;
  return migrateTripToDestinationRegistry(rest);
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

function buildCanonicalTripFirestoreDoc(trip: Trip, editor: User, ownerUid: string): CanonicalTripFirestoreDoc {
  const editorEl = emailLower(editor);
  const raw: CanonicalTripFirestoreDoc = {
    ...trip,
    [OWNER_UID]: ownerUid,
    ...(editorEl ? { [OWNER_EMAIL_LOWER]: editorEl } : {}),
    [PARTICIPANT_EMAILS_LOWER]: participantEmailsLowerFromTrip(trip, editorEl),
  };
  return pruneUndefinedForFirestore(raw) as CanonicalTripFirestoreDoc;
}

/** @deprecated Prefer {@link saveCanonicalTrip}; kept for scripts/tests that create a doc in one shot. */
export function tripToFirestoreDoc(trip: Trip, user: User): CanonicalTripFirestoreDoc {
  return buildCanonicalTripFirestoreDoc(trip, user, user.uid);
}

function snapshotReadableByUser(user: User, data: DocumentData): boolean {
  if (data[OWNER_UID] === user.uid) return true;
  const em = emailLower(user);
  if (!em) return false;
  const list = data[PARTICIPANT_EMAILS_LOWER];
  if (Array.isArray(list) && list.some((x) => typeof x === "string" && x === em)) return true;
  /** Legacy / hand-edited docs: match travelers + viewers on the trip payload (same as save rebuild). */
  const ownerEl = String(data[OWNER_EMAIL_LOWER] ?? "").trim().toLowerCase();
  const trip = stripMeta(data) as Trip;
  return participantEmailsLowerFromTrip(trip, ownerEl).includes(em);
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
      onTrip(stripMeta(data), {
        canManageFirestore: userCanManageCanonicalTripDoc(user, data),
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
  const snap = await getDoc(ref);
  const existing = snap.exists() ? snap.data() : null;
  const ownerUid = existing ? String(existing[OWNER_UID] ?? "") : user.uid;
  if (existing && !userCanManageCanonicalTripDoc(user, existing)) {
    throw new Error("Only the trip owner or a listed traveler can save changes.");
  }
  await setDoc(ref, buildCanonicalTripFirestoreDoc(trip, user, ownerUid || user.uid));
}

export async function updateCanonicalTripLiveLocation(
  db: Firestore,
  tripId: string,
  userLocationKey: string,
  location: TripLiveLocation
): Promise<void> {
  const ref = tripDocRef(db, tripId);
  await updateDoc(ref, {
    [`liveLocations.${userLocationKey}`]: pruneUndefinedForFirestore(location),
  });
}

export async function clearCanonicalTripLiveLocation(
  db: Firestore,
  tripId: string,
  userLocationKey: string
): Promise<void> {
  const ref = tripDocRef(db, tripId);
  await updateDoc(ref, {
    [`liveLocations.${userLocationKey}`]: deleteField(),
  });
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
 * Lists trips the user may open: owned by uid, or listed by email on `participantEmailsLower`
 * (traveler / viewer row with matching Google account email).
 *
 * Uses a single `or(...)` query so Firestore evaluates one list read (two parallel listeners can
 * surface `permission-denied` for the shared branch under some rule setups). Falls back to
 * owner-only if the combined query is denied or hits a missing-index precondition.
 */
export function subscribeMyCanonicalTrips(
  db: Firestore,
  user: User,
  onTrips: (trips: Trip[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const col = collection(db, CANONICAL_TRIPS_COLLECTION);
  const em = emailLower(user);

  let unsub: Unsubscribe | undefined;
  let mode: "combined" | "owner" = em.length > 0 ? "combined" : "owner";

  function emitFromSnap(snap: QuerySnapshot) {
    const trips = snap.docs.map((d) => stripMeta(d.data()));
    sortTripsByUpdatedDesc(trips);
    onTrips(trips);
  }

  function attach() {
    unsub?.();
    const q =
      mode === "owner" || !em.length
        ? query(col, where(OWNER_UID, "==", user.uid))
        : query(
            col,
            or(where(OWNER_UID, "==", user.uid), where(PARTICIPANT_EMAILS_LOWER, "array-contains", em))
          );
    unsub = onSnapshot(
      q,
      emitFromSnap,
      (err) => {
        const code = firestoreErrCode(err);
        const retryAsOwnerOnly =
          mode === "combined" &&
          (code.includes("permission-denied") || code.includes("failed-precondition"));
        if (retryAsOwnerOnly) {
          mode = "owner";
          attach();
          return;
        }
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    );
  }

  attach();

  return () => {
    unsub?.();
  };
}

