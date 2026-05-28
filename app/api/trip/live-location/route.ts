import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CANONICAL_TRIPS_COLLECTION, canonicalTripDocReadableByUser } from "@/lib/canonicalTripsFirestore";

async function loadServiceAccountJson(): Promise<string | null> {
  const env = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (env) return env;
  if (process.env.NODE_ENV !== "development") return null;
  try {
    const p = join(process.cwd(), "trip-planner-494319-095b57d11f14.json");
    const raw = await readFile(p, "utf8");
    return raw.trim() || null;
  } catch {
    return null;
  }
}

async function ensureAdminApp(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (getApps().length) return { ok: true };
  const raw = await loadServiceAccountJson();
  if (!raw) return { ok: false, error: "Missing FIREBASE_SERVICE_ACCOUNT_JSON" };
  try {
    const cred = JSON.parse(raw) as ServiceAccount;
    initializeApp({ credential: cert(cred) });
    return { ok: true };
  } catch {
    return { ok: false, error: "Invalid FIREBASE_SERVICE_ACCOUNT_JSON" };
  }
}

function bearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  const m = /^Bearer\s+(.+)$/.exec(h?.trim() ?? "");
  return m?.[1]?.trim() || null;
}

/** Upsert one `liveLocations.{uid}` entry on the canonical trip (Admin SDK — avoids client watch bugs). */
export async function POST(req: NextRequest) {
  const init = await ensureAdminApp();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });

  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization bearer token" }, { status: 401 });

  const auth = getAuth();
  let uid = "";
  try {
    const decoded = await auth.verifyIdToken(token);
    uid = String(decoded.uid ?? "").trim();
    if (!uid) return NextResponse.json({ error: "Token missing uid" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
  }

  let callerEmail = "";
  try {
    const u = await auth.getUser(uid);
    callerEmail = (u.email ?? "").trim().toLowerCase();
  } catch {
    callerEmail = "";
  }

  let body: {
    tripId?: unknown;
    locationKey?: unknown;
    name?: unknown;
    lat?: unknown;
    lon?: unknown;
    updatedAt?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tripId = typeof body.tripId === "string" ? body.tripId.trim() : "";
  const locationKey = typeof body.locationKey === "string" ? body.locationKey.trim() : "";
  if (!tripId || !locationKey) {
    return NextResponse.json({ error: "Missing tripId or locationKey" }, { status: 400 });
  }
  if (locationKey !== uid) {
    return NextResponse.json({ error: "locationKey must match signed-in uid" }, { status: 403 });
  }

  const lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : NaN;
  const lon = typeof body.lon === "number" && Number.isFinite(body.lon) ? body.lon : NaN;
  const updatedAt = typeof body.updatedAt === "string" ? body.updatedAt.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !updatedAt) {
    return NextResponse.json({ error: "Invalid lat, lon, or updatedAt" }, { status: 400 });
  }

  const db = getFirestore();
  const snap = await db.collection(CANONICAL_TRIPS_COLLECTION).doc(tripId).get();
  if (!snap.exists) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  const payload = (snap.data() ?? {}) as Record<string, unknown>;
  if (!canonicalTripDocReadableByUser(uid, callerEmail, payload)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await snap.ref.set(
    {
      liveLocations: {
        [locationKey]: {
          name: name || "Traveler",
          lat,
          lon,
          updatedAt,
        },
      },
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true });
}

/** Remove one `liveLocations.{uid}` entry (Admin SDK). */
export async function DELETE(req: NextRequest) {
  const init = await ensureAdminApp();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });

  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization bearer token" }, { status: 401 });

  const auth = getAuth();
  let uid = "";
  try {
    const decoded = await auth.verifyIdToken(token);
    uid = String(decoded.uid ?? "").trim();
    if (!uid) return NextResponse.json({ error: "Token missing uid" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
  }

  let callerEmail = "";
  try {
    const u = await auth.getUser(uid);
    callerEmail = (u.email ?? "").trim().toLowerCase();
  } catch {
    callerEmail = "";
  }

  const tripId = (req.nextUrl.searchParams.get("tripId") ?? "").trim();
  const locationKey = (req.nextUrl.searchParams.get("locationKey") ?? "").trim();
  if (!tripId || !locationKey) {
    return NextResponse.json({ error: "Missing tripId or locationKey query params" }, { status: 400 });
  }
  if (locationKey !== uid) {
    return NextResponse.json({ error: "locationKey must match signed-in uid" }, { status: 403 });
  }

  const db = getFirestore();
  const snap = await db.collection(CANONICAL_TRIPS_COLLECTION).doc(tripId).get();
  if (!snap.exists) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  const payload = (snap.data() ?? {}) as Record<string, unknown>;
  if (!canonicalTripDocReadableByUser(uid, callerEmail, payload)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await snap.ref.update({
    [`liveLocations.${locationKey}`]: FieldValue.delete(),
  });

  return NextResponse.json({ ok: true });
}
