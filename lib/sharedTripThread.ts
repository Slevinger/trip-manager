"use client";

import {
  collection,
  onSnapshot,
  query,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import Pusher from "pusher-js";
import { getClientAuth, getDb } from "@/lib/firebase";
import { sharedTripThreadEntryFromRaw } from "@/lib/sharedTripThreadEntryFromRaw";
import {
  SHARED_THREAD_PUSHER_EVENT,
  sharedTripThreadPrivateChannel,
  tripSharedThreadPusherClientEnabled,
} from "@/lib/tripSharedThreadPusherConstants";
import type { SharedTripThreadEntry } from "@/lib/types/user";

/** Subcollection on `trips/{tripId}` holding the shared assistant thread (members shared). */
export const TRIP_ASSISTANT_SHARED_THREAD_SUBCOLLECTION = "assistantThread";

const POLL_MS = 2800;
/** When Pusher delivers push hints, polling stays as a slow safety net. */
const POLL_MS_WITH_PUSH = 22000;

function colRef(db: Firestore, tripId: string) {
  return collection(
    db,
    "trips",
    tripId.trim(),
    TRIP_ASSISTANT_SHARED_THREAD_SUBCOLLECTION
  );
}

function sortEntriesAsc(entries: SharedTripThreadEntry[]): void {
  entries.sort((a, b) => a.createdAtMs - b.createdAtMs);
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
  requestKind?: "general" | "specific" | "suggestions";
  /** JSON string of `TripRecommendation[]` from the same assistant response (capped server-side). */
  recommendationsJson?: string | null;
  /** When set, only these emails may see both the user and agent entries (e.g. `@private` turns). */
  visibleTo?: string[];
  /** Display-only mention tag, e.g. `"@john"`. Entry is still visible to all. */
  directedTo?: string;
}): Promise<void> {
  const tid = opts.tripId.trim();
  if (!tid) return;

  const auth = getClientAuth();
  const token = await auth?.currentUser?.getIdToken();
  if (!token) {
    throw new Error("Not signed in");
  }

  const recJson =
    typeof opts.recommendationsJson === "string" && opts.recommendationsJson.trim()
      ? opts.recommendationsJson.trim().slice(0, 25000)
      : undefined;

  const res = await fetch("/api/chat/shared-trip-thread-append", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tripId: tid,
      fromEmailLower: opts.fromEmailLower.trim().toLowerCase(),
      ...(opts.fromDisplayName?.trim()
        ? { fromDisplayName: opts.fromDisplayName.trim().slice(0, 120) }
        : {}),
      userContent: opts.userContent,
      agentContent: opts.agentContent,
      sentAtMs: opts.sentAtMs,
      ...(opts.tripContextNote?.trim()
        ? { tripContextNote: opts.tripContextNote.trim().slice(0, 500) }
        : {}),
      ...(opts.requestKind === "general" ||
      opts.requestKind === "specific" ||
      opts.requestKind === "suggestions"
        ? { requestKind: opts.requestKind }
        : {}),
      ...(recJson ? { recommendationsJson: recJson } : {}),
      ...(opts.visibleTo && opts.visibleTo.length > 0 ? { visibleTo: opts.visibleTo } : {}),
      ...(opts.directedTo?.trim() ? { directedTo: opts.directedTo.trim() } : {}),
    }),
  });

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error?.trim() || res.statusText || `HTTP ${res.status}`);
  }
}

/**
 * Marks all thread entries at or after `afterMs` as inactive.
 * Used when the user edits a sent message — removes all history from that point onward.
 */
export async function truncateSharedTripThreadAfterMs(
  tripId: string,
  afterMs: number
): Promise<void> {
  const tid = tripId.trim();
  if (!tid) return;

  const auth = getClientAuth();
  const token = await auth?.currentUser?.getIdToken();
  if (!token) return;

  await fetch("/api/chat/shared-trip-thread-truncate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tripId: tid, afterMs }),
  }).catch(() => {});
}

/**
 * Live shared-thread updates: polls GET `/api/chat/shared-trip-thread` (Admin-backed, same
 * membership as append) so client Firestore rules cannot block reads. If the server returns
 * 503 (no service account in dev), falls back to a direct Firestore `onSnapshot` without
 * `orderBy` (sorted client-side).
 *
 * When `NEXT_PUBLIC_PUSHER_KEY` + `NEXT_PUBLIC_PUSHER_CLUSTER` are set, also subscribes to
 * Pusher private channels; the server triggers after Firestore writes so peers refresh quickly
 * without tightening poll interval.
 */
export function subscribeSharedTripThread(
  tripId: string,
  onNext: (entries: SharedTripThreadEntry[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const db = getDb();
  const auth = getClientAuth();
  const tid = tripId.trim();
  if (!tid) {
    onNext([]);
    return () => {};
  }
  if (!db) {
    onNext([]);
    return () => {};
  }

  const dbConn = db;
  const usePush = tripSharedThreadPusherClientEnabled();
  const pollMs = usePush ? POLL_MS_WITH_PUSH : POLL_MS;

  let stopped = false;
  let fsUnsub: Unsubscribe | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let ticking = false;
  let pusherClient: Pusher | undefined;
  let pusherChannel: ReturnType<Pusher["subscribe"]> | undefined;
  const onPusherThreadUpdated = () => void tick();

  function attachFirestoreFallback() {
    if (stopped || fsUnsub) return;
    const q = query(colRef(dbConn, tid));
    fsUnsub = onSnapshot(
      q,
      (snap) => {
        const out: SharedTripThreadEntry[] = [];
        for (const d of snap.docs) {
          const row = sharedTripThreadEntryFromRaw(tid, d.data() as Record<string, unknown>);
          if (row) out.push(row);
        }
        sortEntriesAsc(out);
        onNext(out);
      },
      (err) => {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    );
  }

  async function tick() {
    if (stopped || ticking) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    const user = auth?.currentUser;
    if (!user) {
      onNext([]);
      return;
    }

    ticking = true;
    try {
      const tok = await user.getIdToken();
      const res = await fetch(
        `/api/chat/shared-trip-thread?tripId=${encodeURIComponent(tid)}`,
        { headers: { Authorization: `Bearer ${tok}` } }
      );

      if (res.status === 503) {
        attachFirestoreFallback();
        return;
      }

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        entries?: unknown;
      };

      if (!res.ok) {
        const msg = body.error?.trim() || res.statusText || `HTTP ${res.status}`;
        onError?.(new Error(msg));
        return;
      }

      if (fsUnsub) {
        fsUnsub();
        fsUnsub = undefined;
      }

      const arr = Array.isArray(body.entries) ? body.entries : [];
      const out: SharedTripThreadEntry[] = [];
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const row = sharedTripThreadEntryFromRaw(tid, item as Record<string, unknown>);
        if (row) out.push(row);
      }
      sortEntriesAsc(out);
      onNext(out);
    } catch (e) {
      onError?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      ticking = false;
    }
  }

  void tick();
  interval = setInterval(() => void tick(), pollMs);

  if (usePush && typeof window !== "undefined") {
    try {
      const key = process.env.NEXT_PUBLIC_PUSHER_KEY!.trim();
      const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER!.trim();
      pusherClient = new Pusher(key, {
        cluster,
        /**
         * `channelAuthorization.headersProvider` is sync in typings; async providers can omit
         * the Authorization header and yield 401. Use `authorizer` so we await `getIdToken()`
         * before POSTing to `/api/pusher/auth`.
         */
        authorizer: (channel) => ({
          authorize: (socketId, callback) => {
            const u = auth?.currentUser;
            if (!u) {
              callback(new Error("Not signed in"), null);
              return;
            }
            void (async () => {
              try {
                const token = await u.getIdToken();
                if (!token) {
                  callback(new Error("Missing ID token"), null);
                  return;
                }
                const body = new URLSearchParams({
                  socket_id: socketId,
                  channel_name: channel.name,
                  firebase_id_token: token,
                });
                const res = await fetch("/api/pusher/auth", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Authorization: `Bearer ${token}`,
                  },
                  body,
                });
                const data = (await res.json()) as { auth?: string; error?: string };
                if (!res.ok) {
                  callback(new Error(data.error?.trim() || res.statusText || `HTTP ${res.status}`), null);
                  return;
                }
                if (!data.auth) {
                  callback(new Error("Pusher auth response missing auth"), null);
                  return;
                }
                callback(null, { auth: data.auth });
              } catch (e) {
                callback(e instanceof Error ? e : new Error(String(e)), null);
              }
            })();
          },
        }),
      });
      pusherChannel = pusherClient.subscribe(sharedTripThreadPrivateChannel(tid));
      pusherChannel.bind(SHARED_THREAD_PUSHER_EVENT, onPusherThreadUpdated);
    } catch (e) {
      onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  }

  const onVis = () => {
    if (document.visibilityState === "visible") void tick();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVis);
  }

  return () => {
    stopped = true;
    if (interval) clearInterval(interval);
    fsUnsub?.();
    if (pusherChannel) {
      pusherChannel.unbind(SHARED_THREAD_PUSHER_EVENT, onPusherThreadUpdated);
      pusherChannel.unsubscribe();
      pusherChannel = undefined;
    }
    if (pusherClient) {
      pusherClient.disconnect();
      pusherClient = undefined;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVis);
    }
  };
}

type SharedTripThreadSink = {
  onNext: (entries: SharedTripThreadEntry[]) => void;
  onError?: (e: Error) => void;
};

const sharedTripThreadFanout = new Map<
  string,
  {
    sinks: Set<SharedTripThreadSink>;
    unsub: (() => void) | null;
    /** Latest snapshot so joiners (e.g. chat dock opening) get data without waiting for the next poll. */
    lastEntries: SharedTripThreadEntry[];
  }
>();

function fanoutThreadEntries(tripId: string, entries: SharedTripThreadEntry[]): void {
  const row = sharedTripThreadFanout.get(tripId);
  if (!row) return;
  row.lastEntries = entries.length ? entries.slice() : [];
  for (const s of row.sinks) s.onNext(entries);
}

function fanoutThreadError(tripId: string, err: Error): void {
  const row = sharedTripThreadFanout.get(tripId);
  if (!row) return;
  for (const s of row.sinks) s.onError?.(err);
}

/**
 * Same feed as {@link subscribeSharedTripThread} but one underlying subscription per `tripId`
 * so multiple hooks (e.g. `useTripData` + `useTripAssistantData`) do not duplicate polling /
 * Pusher wiring.
 */
export function subscribeSharedTripThreadShared(
  tripId: string,
  onNext: (entries: SharedTripThreadEntry[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const tid = tripId.trim();
  if (!tid) return () => {};

  const sink: SharedTripThreadSink = { onNext, onError };
  let row = sharedTripThreadFanout.get(tid);
  if (!row) {
    row = { sinks: new Set(), unsub: null, lastEntries: [] };
    sharedTripThreadFanout.set(tid, row);
  }
  row.sinks.add(sink);
  if (row.sinks.size === 1) {
    row.unsub = subscribeSharedTripThread(tid, (entries) => fanoutThreadEntries(tid, entries), (e) =>
      fanoutThreadError(tid, e)
    );
  } else {
    sink.onNext(row.lastEntries);
  }

  return () => {
    const r = sharedTripThreadFanout.get(tid);
    if (!r) return;
    r.sinks.delete(sink);
    if (r.sinks.size === 0) {
      r.unsub?.();
      sharedTripThreadFanout.delete(tid);
    }
  };
}
