import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type {
  Email,
  ImmutableMemoryEntryKind,
  SharedTripThreadEntry,
} from "@/lib/types/user";

/** Subcollection on `trips/{tripId}` holding the shared assistant thread (members shared). */
export const TRIP_ASSISTANT_SHARED_THREAD_SUBCOLLECTION = "assistantThread";

function colRef(db: Firestore, tripId: string) {
  return collection(
    db,
    "trips",
    tripId.trim(),
    TRIP_ASSISTANT_SHARED_THREAD_SUBCOLLECTION
  );
}

/**
 * Appends one (user, assistant) pair to the shared per-trip thread.
 * Visible to every trip member. Append-only; client cannot update or delete.
 */
export async function appendSharedTripThreadTurn(opts: {
  tripId: string;
  fromEmailLower: string;
  fromDisplayName?: string;
  userContent: string;
  agentContent: string;
  sentAtMs: number;
  tripContextNote?: string;
  requestKind?: "general" | "specific";
}): Promise<void> {
  const db = getDb();
  if (!db) return;
  const tid = opts.tripId.trim();
  if (!tid) return;

  const col = colRef(db, tid);
  const userFrom = opts.fromEmailLower.trim().toLowerCase() as Email;
  const ctxNote = (opts.tripContextNote ?? "").trim().slice(0, 500);
  const requestKind =
    opts.requestKind === "general" || opts.requestKind === "specific" ? opts.requestKind : undefined;
  const t0 = Math.floor(opts.sentAtMs);
  const t1 = t0 + 1;

  const userEntry: SharedTripThreadEntry = {
    tripId: tid,
    role: "user",
    from: userFrom,
    ...(opts.fromDisplayName?.trim()
      ? { fromDisplayName: opts.fromDisplayName.trim().slice(0, 120) }
      : {}),
    content: opts.userContent.slice(0, 8000),
    kind: "message",
    active: true,
    createdAtMs: t0,
    ...(ctxNote ? { tripContext: ctxNote } : {}),
    ...(requestKind ? { requestKind } : {}),
  };

  const agentEntry: SharedTripThreadEntry = {
    tripId: tid,
    role: "assistant",
    from: "agent",
    content: opts.agentContent.slice(0, 8000),
    kind: "message",
    active: true,
    createdAtMs: t1,
    ...(ctxNote ? { tripContext: ctxNote } : {}),
    ...(requestKind ? { requestKind } : {}),
  };

  const userDoc = doc(col);
  const agentDoc = doc(col);
  await runTransaction(db, async (tx) => {
    tx.set(userDoc, userEntry);
    tx.set(agentDoc, agentEntry);
  });
}

/** Live shared-thread subscription. Ordered by createdAtMs ascending. */
export function subscribeSharedTripThread(
  tripId: string,
  onNext: (entries: SharedTripThreadEntry[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const db = getDb();
  if (!db) {
    onNext([]);
    return () => {};
  }
  const tid = tripId.trim();
  if (!tid) {
    onNext([]);
    return () => {};
  }
  const q = query(colRef(db, tid), orderBy("createdAtMs", "asc"));
  return onSnapshot(
    q,
    (snap) => {
      const out: SharedTripThreadEntry[] = [];
      for (const d of snap.docs) {
        const raw = d.data() as Record<string, unknown>;
        const role =
          raw.role === "user" || raw.role === "assistant" ? (raw.role as "user" | "assistant") : null;
        const from = typeof raw.from === "string" ? (raw.from as "agent" | Email) : null;
        const content = typeof raw.content === "string" ? raw.content : "";
        const kind =
          raw.kind === "message" || raw.kind === "summary"
            ? (raw.kind as ImmutableMemoryEntryKind)
            : null;
        const active = raw.active === true;
        const createdAtMs =
          typeof raw.createdAtMs === "number" && Number.isFinite(raw.createdAtMs)
            ? raw.createdAtMs
            : NaN;
        if (!role || !from || !kind || !Number.isFinite(createdAtMs)) continue;

        const fromDisplayName =
          typeof raw.fromDisplayName === "string" && raw.fromDisplayName.trim()
            ? raw.fromDisplayName.trim().slice(0, 120)
            : undefined;
        const tripContext =
          typeof raw.tripContext === "string" && raw.tripContext.trim()
            ? raw.tripContext.trim().slice(0, 500)
            : undefined;
        const requestKind =
          raw.requestKind === "general" || raw.requestKind === "specific"
            ? (raw.requestKind as "general" | "specific")
            : undefined;
        const evolveCountRaw = raw.evolveCount;
        const evolveCount =
          typeof evolveCountRaw === "number" && Number.isFinite(evolveCountRaw)
            ? Math.max(0, Math.floor(evolveCountRaw))
            : undefined;
        const memoryCompressed = raw.memoryCompressed === true ? true : undefined;

        out.push({
          tripId: tid,
          role,
          from,
          ...(fromDisplayName ? { fromDisplayName } : {}),
          content: content.slice(0, 8000),
          kind,
          active,
          createdAtMs,
          ...(tripContext ? { tripContext } : {}),
          ...(requestKind ? { requestKind } : {}),
          ...(memoryCompressed ? { memoryCompressed } : {}),
          ...(evolveCount !== undefined ? { evolveCount } : {}),
        });
      }
      onNext(out);
    },
    (err) => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      onNext([]);
    }
  );
}
