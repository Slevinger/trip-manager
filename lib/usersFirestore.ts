import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  setDoc,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { getDb } from "@/lib/firebase";
import type { UserPreferences } from "@/lib/types/trip";
import { parseMemoryArrayFromUserDoc } from "@/lib/tripChatMessages";
import type { AppUser, Email, TripChatMessage } from "@/lib/types/user";

export const USERS_COLLECTION = "users";

export function normalizeUserEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

const EMPTY_PREFS: UserPreferences = { hobbies: [], activities: [], lifestyle: [] };

export function userDocRef(db: Firestore, emailLower: string) {
  return doc(db, USERS_COLLECTION, emailLower);
}

function isoNow(): string {
  return new Date().toISOString();
}

/** Ensures `users/{emailLower}` exists with profile fields and empty preferences when missing. */
export async function bootstrapUserOnSignIn(user: User): Promise<void> {
  const db = getDb();
  if (!db) return;

  const rawEmail = user.email?.trim() ?? "";
  if (!rawEmail) throw new Error("AUTH_EMAIL_REQUIRED_FOR_USER_DOC");

  const emailLower = normalizeUserEmailKey(rawEmail);
  const displayName =
    (typeof user.displayName === "string" && user.displayName.trim()) ||
    rawEmail.split("@")[0] ||
    "";

  const ref = userDocRef(db, emailLower);
  const snap = await getDoc(ref);
  const base = {
    uid: user.uid,
    email: rawEmail,
    emailLower,
    displayName,
    updatedAt: isoNow(),
  };
  if (!snap.exists()) {
    await setDoc(ref, {
      ...base,
      createdAt: isoNow(),
      preferences: EMPTY_PREFS,
    });
    return;
  }
  await setDoc(ref, base, { merge: true });
  const data = snap.data() as Record<string, unknown>;
  if (!data.preferences || typeof data.preferences !== "object") {
    await setDoc(ref, { preferences: EMPTY_PREFS }, { merge: true });
  }
}

function parseUserDoc(data: Record<string, unknown>, emailLowerFromPath: string): AppUser | null {
  const uid = typeof data.uid === "string" ? data.uid : "";
  const email = typeof data.email === "string" ? data.email : "";
  const emailLower =
    typeof data.emailLower === "string" ? normalizeUserEmailKey(data.emailLower) : emailLowerFromPath;
  const displayName = typeof data.displayName === "string" ? data.displayName : "";
  const createdAt = typeof data.createdAt === "string" ? data.createdAt : isoNow();
  const updatedAt = typeof data.updatedAt === "string" ? data.updatedAt : isoNow();

  const rawPrefs = data.preferences;
  let preferences: UserPreferences = { ...EMPTY_PREFS };
  if (rawPrefs && typeof rawPrefs === "object" && !Array.isArray(rawPrefs)) {
    const p = rawPrefs as Record<string, unknown>;
    preferences = {
      hobbies: Array.isArray(p.hobbies) ? p.hobbies.filter((x): x is string => typeof x === "string") : [],
      activities: Array.isArray(p.activities)
        ? p.activities.filter((x): x is string => typeof x === "string")
        : [],
      lifestyle: Array.isArray(p.lifestyle)
        ? p.lifestyle.filter((x): x is string => typeof x === "string")
        : [],
    };
  }

  const displayForParse = email.trim() || emailLower;
  const memory = parseMemoryArrayFromUserDoc(data.memory, {
    userEmailLower: emailLower,
    userEmailDisplay: displayForParse,
  });

  if (!uid) return null;

  return {
    uid,
    email: email || emailLower,
    emailLower,
    displayName,
    createdAt,
    updatedAt,
    preferences,
    ...(memory.length > 0 ? { memory } : {}),
  };
}

export function subscribeUser(
  emailLower: string,
  onNext: (user: AppUser | null) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const db = getDb();
  if (!db) {
    onNext(null);
    return () => {};
  }

  const key = normalizeUserEmailKey(emailLower);
  const ref = userDocRef(db, key);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onNext(null);
        return;
      }
      const parsed = parseUserDoc(snap.data() as Record<string, unknown>, key);
      onNext(parsed);
    },
    (err) => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      onNext(null);
    }
  );
}

export async function updateUserPreferences(emailLower: string, prefs: UserPreferences): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Firestore is not configured");

  const key = normalizeUserEmailKey(emailLower);
  await setDoc(
    userDocRef(db, key),
    {
      preferences: {
        hobbies: prefs.hobbies,
        activities: prefs.activities,
        lifestyle: prefs.lifestyle,
      },
      updatedAt: isoNow(),
    },
    { merge: true }
  );
}

const MAX_CHAT_MESSAGES = 200;

/**
 * Appends one user line and one agent line to `users/{email}.memory`
 * (flattened `TripChatMessage[]`, trimmed to last MAX_CHAT_MESSAGES).
 */
export async function appendTripChatTurn(
  emailLower: string,
  opts: {
    tripId: string;
    userFromEmail: string;
    userContent: string;
    agentContent: string;
    contextSummary?: string;
    sentAtMs: number;
  }
): Promise<void> {
  const db = getDb();
  if (!db) return;

  const key = normalizeUserEmailKey(emailLower);
  const ref = userDocRef(db, key);
  const userFrom = normalizeUserEmailKey(opts.userFromEmail) as Email;
  const t0 = new Date(opts.sentAtMs).toISOString();
  const t1 = new Date(opts.sentAtMs + 1).toISOString();
  const userRow: TripChatMessage = {
    tripId: opts.tripId,
    from: userFrom,
    content: opts.userContent.slice(0, 8000),
    timeStamp: t0,
    ...(opts.contextSummary?.trim()
      ? { contextSummary: opts.contextSummary.trim().slice(0, 500) }
      : {}),
  };
  const agentRow: TripChatMessage = {
    tripId: opts.tripId,
    from: "agent",
    content: opts.agentContent.slice(0, 8000),
    timeStamp: t1,
  };

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as Record<string, unknown> | undefined;
    const display = typeof data?.email === "string" ? data.email : key;
    const prev = parseMemoryArrayFromUserDoc(data?.memory, {
      userEmailLower: key,
      userEmailDisplay: display,
    });
    const next = [...prev, userRow, agentRow].slice(-MAX_CHAT_MESSAGES);
    tx.set(
      ref,
      {
        memory: next,
        updatedAt: isoNow(),
      },
      { merge: true }
    );
  });
}

/**
 * Removes every stored line for `tripId`, then writes a single assistant summary line
 * (used after {@link agentEvolve} compresses the transcript).
 */
export async function replaceTripChatMemoryForTrip(
  emailLower: string,
  tripId: string,
  agentSummaryContent: string,
  sentAtMs: number
): Promise<void> {
  const db = getDb();
  if (!db) return;

  const key = normalizeUserEmailKey(emailLower);
  const tid = tripId.trim();
  if (!tid) return;

  const ref = userDocRef(db, key);
  const agentRow: TripChatMessage = {
    tripId: tid,
    from: "agent",
    content: agentSummaryContent.slice(0, 8000),
    timeStamp: new Date(sentAtMs).toISOString(),
  };

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as Record<string, unknown> | undefined;
    const display = typeof data?.email === "string" ? data.email : key;
    const prev = parseMemoryArrayFromUserDoc(data?.memory, {
      userEmailLower: key,
      userEmailDisplay: display,
    });
    const other = prev.filter((m) => m.tripId !== tid);
    const next = [...other, agentRow].slice(-MAX_CHAT_MESSAGES);
    tx.set(
      ref,
      {
        memory: next,
        updatedAt: isoNow(),
      },
      { merge: true }
    );
  });
}
