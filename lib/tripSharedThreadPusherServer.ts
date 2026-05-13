import Pusher from "pusher";
import {
  SHARED_THREAD_PUSHER_EVENT,
  sharedTripThreadPrivateChannel,
} from "@/lib/tripSharedThreadPusherConstants";

let cached: Pusher | null | undefined;

function pusherServer(): Pusher | null {
  if (cached !== undefined) return cached;
  const appId = process.env.PUSHER_APP_ID?.trim();
  const key = (process.env.PUSHER_KEY ?? process.env.NEXT_PUBLIC_PUSHER_KEY)?.trim();
  const secret = process.env.PUSHER_SECRET?.trim();
  const cluster = (process.env.PUSHER_CLUSTER ?? process.env.NEXT_PUBLIC_PUSHER_CLUSTER)?.trim();
  if (!appId || !key || !secret || !cluster) {
    cached = null;
    return null;
  }
  try {
    cached = new Pusher({ appId, key, secret, cluster, useTLS: true });
  } catch {
    cached = null;
  }
  return cached;
}

/** True when server can trigger Pusher (same env needed for `/api/pusher/auth`). */
export function tripSharedThreadPusherServerConfigured(): boolean {
  return pusherServer() != null;
}

export function getTripSharedThreadPusherForAuth(): Pusher | null {
  return pusherServer();
}

/**
 * Notify subscribers that `trips/{tripId}/assistantThread` changed. Clients should re-fetch
 * via GET `/api/chat/shared-trip-thread` (Firestore stays authoritative).
 *
 * Next.js routes call this after Admin writes. For any other writer (maintenance scripts,
 * a future Firestore `onWrite` Cloud Function on `assistantThread`), call the same helper so
 * delivery stays in sync without duplicating chat payloads in Pusher.
 */
export async function notifySharedTripThreadUpdated(tripId: string): Promise<void> {
  const p = pusherServer();
  const tid = tripId.trim();
  if (!p || !tid) return;
  const channel = sharedTripThreadPrivateChannel(tid);
  await p.trigger(channel, SHARED_THREAD_PUSHER_EVENT, { t: Date.now() });
}
