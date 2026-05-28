import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalTripDocReadableByUser } from "@/lib/canonicalTripsFirestore";
import { sharedTripThreadEntryFromRaw } from "@/lib/sharedTripThreadEntryFromRaw";
import type { SharedTripThreadEntry } from "@/lib/types/user";

export const dynamic = "force-dynamic";

/**
 * Reads `trips/{tripId}/assistantThread` via Admin SDK (bypasses client rules) and enforces
 * the same party check as POST `/api/chat/shared-trip-thread-append`.
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

export async function GET(req: NextRequest) {
  const init = await ensureAdminApp();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });

  const token = bearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Missing Authorization bearer token" }, { status: 401 });
  }

  const tripIdRaw = req.nextUrl.searchParams.get("tripId");
  const tripId = typeof tripIdRaw === "string" ? tripIdRaw.trim() : "";
  if (!tripId) return NextResponse.json({ error: "Missing tripId" }, { status: 400 });

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
  if (!canonicalSnap.exists) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const tripPayload = (canonicalSnap.data() ?? {}) as Record<string, unknown>;
  if (!canonicalTripDocReadableByUser(uid, effectiveEmail, tripPayload)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const col = db.collection("trips").doc(tripId).collection("assistantThread");
  const snap = await col.orderBy("createdAtMs", "asc").limit(500).get();
  const entries: SharedTripThreadEntry[] = [];
  for (const d of snap.docs) {
    const row = sharedTripThreadEntryFromRaw(tripId, d.data() as Record<string, unknown>);
    if (!row) continue;
    // Filter private entries: if visibleTo is set, only return to emails in that list.
    if (row.visibleTo && row.visibleTo.length > 0) {
      if (!effectiveEmail || !row.visibleTo.includes(effectiveEmail)) continue;
    }
    entries.push(row);
  }

  return NextResponse.json({ entries });
}
