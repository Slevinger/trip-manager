import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalTripDocReadableByUser } from "@/lib/canonicalTripsFirestore";
import { notifySharedTripThreadUpdated } from "@/lib/tripSharedThreadPusherServer";

/**
 * Truncates the shared trip thread by marking all entries with
 * `createdAtMs >= afterMs` as inactive. Any trip member may call this
 * (e.g. when editing a sent message).
 */

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
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/.exec(h.trim());
  return m?.[1]?.trim() || null;
}

export async function POST(req: NextRequest) {
  const init = await ensureAdminApp();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });

  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization bearer token" }, { status: 401 });

  let body: { tripId?: unknown; afterMs?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tripId = typeof body.tripId === "string" ? body.tripId.trim() : "";
  if (!tripId) return NextResponse.json({ error: "Missing tripId" }, { status: 400 });

  const afterMs =
    typeof body.afterMs === "number" && Number.isFinite(body.afterMs)
      ? Math.floor(body.afterMs)
      : NaN;
  if (Number.isNaN(afterMs)) return NextResponse.json({ error: "Invalid afterMs" }, { status: 400 });

  const auth = getAuth();
  let uid = "";
  let tokenEmail = "";
  try {
    const decoded = await auth.verifyIdToken(token);
    uid = String(decoded.uid ?? "").trim();
    if (!uid) return NextResponse.json({ error: "Token missing uid" }, { status: 401 });
    if (typeof decoded.email === "string" && decoded.email.trim()) {
      tokenEmail = decoded.email.trim().toLowerCase();
    }
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
  const effectiveEmail = callerEmail || tokenEmail;

  const db = getFirestore();
  const canonicalSnap = await db.collection("canonicalTrips").doc(tripId).get();
  if (!canonicalSnap.exists) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const tripPayload = (canonicalSnap.data() ?? {}) as Record<string, unknown>;
  if (!canonicalTripDocReadableByUser(uid, effectiveEmail, tripPayload)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const col = db.collection("trips").doc(tripId).collection("assistantThread");
  const snap = await col
    .where("active", "==", true)
    .where("createdAtMs", ">=", afterMs)
    .get();

  if (snap.empty) return NextResponse.json({ ok: true, cleared: 0 });

  const now = Date.now();
  let written = 0;
  let batch = db.batch();
  let inBatch = 0;
  for (const d of snap.docs) {
    batch.set(d.ref, { active: false, truncatedAtMs: now, truncatedByUid: uid }, { merge: true });
    inBatch += 1;
    written += 1;
    if (inBatch >= 450) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();

  void notifySharedTripThreadUpdated(tripId).catch(() => {});

  return NextResponse.json({ ok: true, cleared: written });
}
