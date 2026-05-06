import { NextRequest, NextResponse } from "next/server";
import { requireFirebaseUser } from "@/lib/adminAuth";
import {
  CANONICAL_TRIPS_COLLECTION,
  canonicalFirestoreDataToTrip,
  canonicalTripDocReadableByUser,
  OWNER_UID,
  PARTICIPANT_UIDS,
} from "@/lib/canonicalTripsFirestore";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import type { Trip } from "@/lib/types/trip";
import type { QuerySnapshot } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

function sortTripsByUpdatedDesc(trips: Trip[]): void {
  trips.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

export async function GET(req: NextRequest) {
  const auth = await requireFirebaseUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json(
      { error: "Server Firestore not configured (FIREBASE_SERVICE_ACCOUNT_JSON)" },
      { status: 503 }
    );
  }

  const uid = auth.uid;
  const emailLower = auth.emailLower;
  const col = db.collection(CANONICAL_TRIPS_COLLECTION);

  const [owned, shared] = await Promise.all([
    col.where(OWNER_UID, "==", uid).get(),
    col.where(PARTICIPANT_UIDS, "array-contains", uid).get(),
  ]);

  const merged = new Map<string, Trip>();

  function ingest(snap: QuerySnapshot) {
    for (const d of snap.docs) {
      const raw = (d.data() ?? {}) as Record<string, unknown>;
      const id =
        typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : d.id;
      const row = { ...raw, id };
      if (!canonicalTripDocReadableByUser(uid, emailLower, row)) continue;
      merged.set(id, canonicalFirestoreDataToTrip(row));
    }
  }

  ingest(owned);
  ingest(shared);

  const trips = Array.from(merged.values());
  sortTripsByUpdatedDesc(trips);
  return NextResponse.json({ trips });
}
