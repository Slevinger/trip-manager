import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalTripDocReadableByUser } from "@/lib/canonicalTripsFirestore";
import type { Email, SharedTripThreadEntry } from "@/lib/types/user";

/**
 * Append-only writes for `trips/{tripId}/assistantThread`. Uses Admin SDK (bypasses rules)
 * and enforces trip membership with {@link canonicalTripDocReadableByUser}.
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

  let body: {
    tripId?: unknown;
    fromEmailLower?: unknown;
    fromDisplayName?: unknown;
    userContent?: unknown;
    agentContent?: unknown;
    sentAtMs?: unknown;
    tripContextNote?: unknown;
    requestKind?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tripId = typeof body.tripId === "string" ? body.tripId.trim() : "";
  if (!tripId) return NextResponse.json({ error: "Missing tripId" }, { status: 400 });

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

  const fromLower =
    typeof body.fromEmailLower === "string" ? body.fromEmailLower.trim().toLowerCase() : "";
  if (!fromLower) return NextResponse.json({ error: "Missing fromEmailLower" }, { status: 400 });
  if (callerEmail && fromLower !== callerEmail) {
    return NextResponse.json({ error: "fromEmailLower does not match signed-in user" }, { status: 403 });
  }

  const userContent = typeof body.userContent === "string" ? body.userContent : "";
  const agentContent = typeof body.agentContent === "string" ? body.agentContent : "";
  if (!userContent.trim() || !agentContent.trim()) {
    return NextResponse.json({ error: "Missing userContent or agentContent" }, { status: 400 });
  }

  const sentAtMs =
    typeof body.sentAtMs === "number" && Number.isFinite(body.sentAtMs)
      ? body.sentAtMs
      : typeof body.sentAtMs === "string" && body.sentAtMs.trim()
        ? Number(body.sentAtMs)
        : NaN;
  if (!Number.isFinite(sentAtMs)) {
    return NextResponse.json({ error: "Invalid sentAtMs" }, { status: 400 });
  }

  const ctxNote =
    typeof body.tripContextNote === "string" ? body.tripContextNote.trim().slice(0, 500) : "";
  const requestKindRaw = body.requestKind;
  const requestKind =
    requestKindRaw === "general" || requestKindRaw === "specific" || requestKindRaw === "suggestions"
      ? requestKindRaw
      : undefined;

  const db = getFirestore();
  const canonicalSnap = await db.collection("canonicalTrips").doc(tripId).get();
  if (!canonicalSnap.exists) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const tripPayload = (canonicalSnap.data() ?? {}) as Record<string, unknown>;
  if (!canonicalTripDocReadableByUser(uid, callerEmail, tripPayload)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const t0 = Math.floor(sentAtMs);
  const t1 = t0 + 1;
  const displayName =
    typeof body.fromDisplayName === "string" && body.fromDisplayName.trim()
      ? body.fromDisplayName.trim().slice(0, 120)
      : undefined;

  const userEntry: SharedTripThreadEntry = {
    tripId,
    role: "user",
    from: fromLower as Email,
    ...(displayName ? { fromDisplayName: displayName } : {}),
    content: userContent.slice(0, 8000),
    kind: "message",
    active: true,
    createdAtMs: t0,
    ...(ctxNote ? { tripContext: ctxNote } : {}),
    ...(requestKind ? { requestKind } : {}),
  };

  const agentEntry: SharedTripThreadEntry = {
    tripId,
    role: "assistant",
    from: "agent",
    content: agentContent.slice(0, 8000),
    kind: "message",
    active: true,
    createdAtMs: t1,
    ...(ctxNote ? { tripContext: ctxNote } : {}),
    ...(requestKind ? { requestKind } : {}),
  };

  const col = db.collection("trips").doc(tripId).collection("assistantThread");
  const batch = db.batch();
  batch.set(col.doc(), userEntry);
  batch.set(col.doc(), agentEntry);
  await batch.commit();

  return NextResponse.json({ ok: true });
}
