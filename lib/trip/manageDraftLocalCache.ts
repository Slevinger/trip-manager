const KEY_PREFIX = "trip-manage-draft-v1:";

function manageDraftLocalKey(tripId: string): string {
  return `${KEY_PREFIX}${tripId.trim()}`;
}

/** Removes legacy manage-draft backup keys (we no longer hydrate from localStorage). */
export function clearManageDraftLocal(tripId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(manageDraftLocalKey(tripId));
  } catch {
    /* ignore */
  }
}
