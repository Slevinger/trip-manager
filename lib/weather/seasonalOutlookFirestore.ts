import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

const COLLECTION = "weatherSeasonalOutlook";

/** Stable key for one seasonal outlook (shared across trips with same geography + window + hints). */
export function seasonalOutlookFingerprint(args: {
  lat: number;
  lon: number;
  tripStartIso: string;
  tripEndIso: string;
  destHints: string;
}): string {
  const payload = [
    args.lat.toFixed(4),
    args.lon.toFixed(4),
    args.tripStartIso.slice(0, 10),
    args.tripEndIso.slice(0, 10),
    args.destHints,
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export async function loadSeasonalOutlookCache(args: {
  fingerprint: string;
  todayUtcDay: string;
}): Promise<string | null> {
  const db = getAdminFirestore();
  if (!db) return null;
  try {
    const ref = db.collection(COLLECTION).doc(args.fingerprint);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const d = snap.data();
    if (
      d?.cacheDayUtc === args.todayUtcDay &&
      typeof d.outlook === "string" &&
      d.outlook.trim() &&
      d.fingerprint === args.fingerprint
    ) {
      return d.outlook.trim();
    }
  } catch (e) {
    console.warn("[seasonalOutlookFirestore] read failed", e);
  }
  return null;
}

export async function saveSeasonalOutlookCache(args: {
  fingerprint: string;
  todayUtcDay: string;
  outlook: string;
  lat: number;
  lon: number;
  tripStartIso: string;
  tripEndIso: string;
}): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;
  try {
    const ref = db.collection(COLLECTION).doc(args.fingerprint);
    await ref.set(
      {
        fingerprint: args.fingerprint,
        cacheDayUtc: args.todayUtcDay,
        outlook: args.outlook.slice(0, 2000),
        lat: args.lat,
        lon: args.lon,
        tripStartIso: args.tripStartIso.slice(0, 10),
        tripEndIso: args.tripEndIso.slice(0, 10),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("[seasonalOutlookFirestore] write failed", e);
  }
}
