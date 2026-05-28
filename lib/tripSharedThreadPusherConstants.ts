/** Pusher event name — payload is a hint only; clients re-fetch from Firestore via GET proxy. */
export const SHARED_THREAD_PUSHER_EVENT = "thread-updated" as const;

const PREFIX = "private-shared-thread-";

/** Private channel per trip; must match server trigger + `/api/pusher/auth` checks. */
export function sharedTripThreadPrivateChannel(tripId: string): string {
  return `${PREFIX}${tripId.trim()}`;
}

export function tripIdFromSharedThreadPrivateChannel(channelName: string): string | null {
  const c = channelName.trim();
  if (!c.startsWith(PREFIX)) return null;
  const id = c.slice(PREFIX.length).trim();
  return id.length ? id : null;
}

/** Browser client has public Pusher key + cluster (must match server `PUSHER_*` / triggers). */
export function tripSharedThreadPusherClientEnabled(): boolean {
  return Boolean(
    typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_PUSHER_KEY?.trim() &&
      process.env.NEXT_PUBLIC_PUSHER_CLUSTER?.trim()
  );
}
