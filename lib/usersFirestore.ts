import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { getDb } from "@/lib/firebase";
import type { UserPreferences } from "@/lib/types/trip";
import { parseMemoryArrayFromUserDoc } from "@/lib/tripChatMessages";
import type { AppUser, Email, ImmutableMemoryQueueEntry, TripChatMessage } from "@/lib/types/user";

export const USERS_COLLECTION = "users";

/** Per-trip assistant transcript: `users/{emailLower}/tripAssistantChats/{tripId}`. */
export const TRIP_ASSISTANT_CHATS_SUBCOLLECTION = "tripAssistantChats";

/** Central immutable user history: `users/{emailLower}/immutableMemoryQueueEntries/{entryId}`. */
export const IMMUTABLE_MEMORY_QUEUE_ENTRIES_COLLECTION = "immutableMemoryQueueEntries";

export function tripAssistantChatDocRef(db: Firestore, emailLower: string, tripId: string) {
  const tid = tripId.trim();
  return doc(
    db,
    USERS_COLLECTION,
    normalizeUserEmailKey(emailLower),
    TRIP_ASSISTANT_CHATS_SUBCOLLECTION,
    tid
  );
}

export function normalizeUserEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

const EMPTY_PREFS: UserPreferences = { hobbies: [], activities: [], lifestyle: [] };

export function userDocRef(db: Firestore, emailLower: string) {
  return doc(db, USERS_COLLECTION, emailLower);
}

function immutableQueueEntryCollectionRef(db: Firestore, emailLower: string) {
  return collection(
    db,
    USERS_COLLECTION,
    normalizeUserEmailKey(emailLower),
    IMMUTABLE_MEMORY_QUEUE_ENTRIES_COLLECTION
  );
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

/**
 * Live transcript for one trip (Firestore doc delete on “Forget”).
 * When missing, UI falls back to `users.{email}.memory` filtered by tripId.
 */
export function subscribeTripAssistantChat(
  emailLower: string,
  tripId: string,
  displayEmailForParse: string,
  onNext: (snapshot: { exists: boolean; messages: TripChatMessage[] }) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const db = getDb();
  if (!db) {
    onNext({ exists: false, messages: [] });
    return () => {};
  }

  const key = normalizeUserEmailKey(emailLower);
  const tid = tripId.trim();
  if (!tid) {
    onNext({ exists: false, messages: [] });
    return () => {};
  }

  const ref = tripAssistantChatDocRef(db, key, tid);
  const parseOpts = {
    userEmailLower: key,
    userEmailDisplay: displayEmailForParse.trim() || key,
  };

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onNext({ exists: false, messages: [] });
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      const messages = parseMemoryArrayFromUserDoc(data.messages, parseOpts).filter(
        (m) => m.tripId === tid
      );
      onNext({ exists: true, messages });
    },
    (err) => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      onNext({ exists: false, messages: [] });
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
 * Appends one user + agent turn to the immutable per-user queue (never deleted).
 * Uses a monotonic seq stored on `users/{emailLower}.immutableQueueSeq` to order entries.
 *
 * Pass `tripContextNote` to attach a one-line trip-context snapshot to the saved
 * pair (used for entries stored under a virtual scope like `__global__`, so the
 * compaction LLM keeps trip provenance even though the row's `tripId` is the
 * virtual scope). When provided it is also prefixed onto the saved user content
 * so the model sees the context inline. `originTripId` records the real trip id.
 */
export async function appendImmutableMemoryQueueTurn(
  emailLower: string,
  opts: {
    tripId: string;
    userFromEmail: string;
    userContent: string;
    agentContent: string;
    sentAtMs: number;
    tripContextNote?: string;
    originTripId?: string;
    requestKind?: "general" | "specific" | "suggestions";
  }
): Promise<void> {
  const db = getDb();
  if (!db) return;

  const key = normalizeUserEmailKey(emailLower);
  const tid = opts.tripId.trim();
  if (!tid) return;

  const userFrom = normalizeUserEmailKey(opts.userFromEmail) as Email;
  const createdAtMs = Math.floor(opts.sentAtMs);

  const ctxNote = (opts.tripContextNote ?? "").trim().slice(0, 500);
  const origin = (opts.originTripId ?? "").trim();
  const requestKind =
    opts.requestKind === "general" ||
    opts.requestKind === "specific" ||
    opts.requestKind === "suggestions"
      ? opts.requestKind
      : undefined;
  const ctxPrefix = ctxNote ? `[trip-context] ${ctxNote}\n` : "";
  const userContentSaved = (ctxPrefix + opts.userContent).slice(0, 8000);

  const userRef = userDocRef(db, key);
  const entriesCol = immutableQueueEntryCollectionRef(db, key);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    const data = (snap.data() as Record<string, unknown> | undefined) ?? {};
    const prevSeqRaw = data.immutableQueueSeq;
    const prevSeq =
      typeof prevSeqRaw === "number" && Number.isFinite(prevSeqRaw) ? Math.max(0, Math.floor(prevSeqRaw)) : 0;

    const seqUser = prevSeq + 1;
    const seqAgent = prevSeq + 2;

    const userDoc = doc(entriesCol);
    const agentDoc = doc(entriesCol);

    const userEntry: ImmutableMemoryQueueEntry = {
      seq: seqUser,
      tripId: tid,
      role: "user",
      from: userFrom,
      content: userContentSaved,
      kind: "message",
      active: true,
      createdAtMs,
      ...(ctxNote ? { tripContext: ctxNote } : {}),
      ...(origin ? { originTripId: origin } : {}),
      ...(requestKind ? { requestKind } : {}),
    };

    const agentEntry: ImmutableMemoryQueueEntry = {
      seq: seqAgent,
      tripId: tid,
      role: "assistant",
      from: "agent",
      content: opts.agentContent.slice(0, 8000),
      kind: "message",
      active: true,
      createdAtMs: createdAtMs + 1,
      ...(ctxNote ? { tripContext: ctxNote } : {}),
      ...(origin ? { originTripId: origin } : {}),
      ...(requestKind ? { requestKind } : {}),
    };

    tx.set(userDoc, userEntry);
    tx.set(agentDoc, agentEntry);
    tx.set(userRef, { immutableQueueSeq: seqAgent, updatedAt: isoNow() }, { merge: true });
  });
}

export function subscribeImmutableMemoryQueueEntries(
  emailLower: string,
  onNext: (rows: ImmutableMemoryQueueEntry[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const db = getDb();
  if (!db) {
    onNext([]);
    return () => {};
  }
  const q = query(immutableQueueEntryCollectionRef(db, emailLower), orderBy("seq", "asc"));
  return onSnapshot(
    q,
    (snap) => {
      const out: ImmutableMemoryQueueEntry[] = [];
      for (const d of snap.docs) {
        const raw = d.data() as Record<string, unknown>;
        // Minimal shape validation; treat unknown rows as absent.
        const seq = typeof raw.seq === "number" ? raw.seq : NaN;
        const tripId = typeof raw.tripId === "string" ? raw.tripId : "";
        const role = raw.role === "user" || raw.role === "assistant" ? raw.role : null;
        const from = typeof raw.from === "string" ? (raw.from as "agent" | Email) : null;
        const content = typeof raw.content === "string" ? raw.content : "";
        const kind = raw.kind === "message" || raw.kind === "summary" ? raw.kind : null;
        const active = raw.active === true;
        const createdAtMs = typeof raw.createdAtMs === "number" ? raw.createdAtMs : NaN;
        if (!Number.isFinite(seq) || !tripId || !role || !from || !kind || !Number.isFinite(createdAtMs)) continue;
        const evolveCountRaw = raw.evolveCount;
        const tripContextRaw = typeof raw.tripContext === "string" ? raw.tripContext.trim() : "";
        const originTripIdRaw = typeof raw.originTripId === "string" ? raw.originTripId.trim() : "";
        const requestKindRaw =
          raw.requestKind === "general" ||
          raw.requestKind === "specific" ||
          raw.requestKind === "suggestions"
            ? (raw.requestKind as "general" | "specific" | "suggestions")
            : undefined;
        const row: ImmutableMemoryQueueEntry = {
          seq,
          tripId,
          role,
          from,
          content: content.slice(0, 8000),
          kind,
          active,
          createdAtMs,
          ...(raw.memoryCompressed === true ? { memoryCompressed: true } : {}),
          ...(typeof evolveCountRaw === "number" && Number.isFinite(evolveCountRaw)
            ? { evolveCount: Math.max(0, Math.floor(evolveCountRaw)) }
            : {}),
          ...(tripContextRaw ? { tripContext: tripContextRaw } : {}),
          ...(originTripIdRaw ? { originTripId: originTripIdRaw } : {}),
          ...(requestKindRaw ? { requestKind: requestKindRaw } : {}),
        };
        out.push(row);
      }
      onNext(out);
    },
    (err) => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      onNext([]);
    }
  );
}

/**
 * Appends one user + agent turn to `users/{email}/tripAssistantChats/{tripId}` (canonical)
 * and mirrors into `users/{email}.memory` for backwards compatibility.
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
  const tid = opts.tripId.trim();
  if (!tid) return;

  const ref = userDocRef(db, key);
  const subRef = tripAssistantChatDocRef(db, key, tid);
  const userFrom = normalizeUserEmailKey(opts.userFromEmail) as Email;
  const t0 = new Date(opts.sentAtMs).toISOString();
  const t1 = new Date(opts.sentAtMs + 1).toISOString();
  const userRow: TripChatMessage = {
    tripId: tid,
    from: userFrom,
    content: opts.userContent.slice(0, 8000),
    timeStamp: t0,
    ...(opts.contextSummary?.trim()
      ? { contextSummary: opts.contextSummary.trim().slice(0, 500) }
      : {}),
  };
  const agentRow: TripChatMessage = {
    tripId: tid,
    from: "agent",
    content: opts.agentContent.slice(0, 8000),
    timeStamp: t1,
  };

  const parseOptsSub = { userEmailLower: key, userEmailDisplay: userFrom };

  await runTransaction(db, async (tx) => {
    const subSnap = await tx.get(subRef);
    const subPrev = subSnap.exists()
      ? parseMemoryArrayFromUserDoc((subSnap.data() as Record<string, unknown>)?.messages, parseOptsSub)
      : [];
    const subNext = [...subPrev, userRow, agentRow].slice(-MAX_CHAT_MESSAGES);
    tx.set(subRef, { messages: subNext, updatedAt: isoNow() }, { merge: true });
  });

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
 * Replaces this trip’s transcript with one assistant summary line (subcollection doc + legacy memory).
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
  const subRef = tripAssistantChatDocRef(db, key, tid);
  const agentRow: TripChatMessage = {
    tripId: tid,
    from: "agent",
    content: agentSummaryContent.slice(0, 8000),
    timeStamp: new Date(sentAtMs).toISOString(),
    memoryCompressed: true,
  };

  await setDoc(subRef, {
    messages: [agentRow],
    updatedAt: isoNow(),
  });

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

/**
 * Deletes assistant chat for **this signed-in user** and **this trip id only**:
 * removes `users/{emailLower}/tripAssistantChats/{tripId}` and drops matching rows from
 * `users/{emailLower}.memory`. Other trips on the same account and other users’ chats are untouched.
 */
export async function clearTripChatMemoryForTrip(emailLower: string, tripId: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  const key = normalizeUserEmailKey(emailLower);
  const tid = tripId.trim();
  if (!tid) return;

  const ref = userDocRef(db, key);
  const subRef = tripAssistantChatDocRef(db, key, tid);

  await deleteDoc(subRef);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as Record<string, unknown> | undefined;
    const display = typeof data?.email === "string" ? data.email : key;
    const prev = parseMemoryArrayFromUserDoc(data?.memory, {
      userEmailLower: key,
      userEmailDisplay: display,
    });
    const next = prev.filter((m) => m.tripId !== tid).slice(-MAX_CHAT_MESSAGES);
    const patch: Record<string, unknown> = { updatedAt: isoNow() };
    if (next.length === 0) {
      patch.memory = deleteField();
    } else {
      patch.memory = next;
    }
    tx.set(ref, patch, { merge: true });
  });
}
