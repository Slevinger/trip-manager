import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalTripDocReadableByUser } from "@/lib/canonicalTripsFirestore";
import { getTripSharedThreadPusherForAuth } from "@/lib/tripSharedThreadPusherServer";
import { tripIdFromSharedThreadPrivateChannel } from "@/lib/tripSharedThreadPusherConstants";

export const dynamic = "force-dynamic";

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

/**
 * Pusher private-channel auth for `private-shared-thread-{tripId}`.
 * Same trip access as GET `/api/chat/shared-trip-thread`.
 */
export async function POST(req: NextRequest) {
  const pusher = getTripSharedThreadPusherForAuth();
  if (!pusher) {
    return NextResponse.json({ error: "Pusher not configured" }, { status: 503 });
  }

  const init = await ensureAdminApp();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected form body" }, { status: 400 });
  }

  const socketId = String(form.get("socket_id") ?? "").trim();
  const channelName = String(form.get("channel_name") ?? "").trim();
  const token =
    bearerToken(req)?.trim() ||
    String(form.get("firebase_id_token") ?? "").trim();
  if (!token) {
    return NextResponse.json(
      { error: "Missing Firebase id token (Authorization bearer or firebase_id_token form field)" },
      { status: 401 }
    );
  }
  if (!socketId || !channelName) {
    return NextResponse.json({ error: "Missing socket_id or channel_name" }, { status: 400 });
  }

  const tripId = tripIdFromSharedThreadPrivateChannel(channelName);
  if (!tripId) {
    return NextResponse.json({ error: "Unsupported channel" }, { status: 400 });
  }

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

  const signed = pusher.authorizeChannel(socketId, channelName);
  return NextResponse.json(signed);
}
