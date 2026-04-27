import type { Trip } from "@/lib/types/trip";
import snapshot from "./mock-trip-from-firestore.json";

/** Original Firestore document id this snapshot was exported from. */
export const MOCK_TRIP_SOURCE_FIRESTORE_ID =
  "5dba4920-7b22-4a42-9fc7-81a3518f66d8";

/** Normalized trip shape (same as `normalizeTripFromFirestore` output). */
export function getMockTripFromFirestore(): Trip {
  return structuredClone(snapshot as Trip);
}

/** Same data under a different trip id (e.g. local-only duplicate). */
export function getMockTripFromFirestoreWithId(newTripId: string): Trip {
  const t = getMockTripFromFirestore();
  return { ...t, id: newTripId };
}
