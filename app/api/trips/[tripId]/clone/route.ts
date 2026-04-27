import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import * as admin from "firebase-admin";
import { getAdminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";

function bearerTokenFromRequest(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/.exec(auth);
  return m?.[1]?.trim() ?? null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await context.params;
  if (!tripId?.trim()) {
    return NextResponse.json({ error: "missing_trip_id" }, { status: 400 });
  }

  const token = bearerTokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ error: "missing_bearer_token" }, { status: 401 });
  }

  try {
    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;
    const email = typeof decoded.email === "string" ? decoded.email.trim() : "";
    const emailLower = normalizeEmail(email);
    if (!uid || !emailLower) {
      return NextResponse.json({ error: "auth_email_required" }, { status: 403 });
    }

    const db = admin.firestore();
    const sourceRef = db.collection("trips").doc(tripId);
    const sourceSnap = await sourceRef.get();
    if (!sourceSnap.exists) {
      return NextResponse.json({ error: "source_trip_not_found" }, { status: 404 });
    }

    const memberSnap = await sourceRef.collection("members").doc(uid).get();
    if (!memberSnap.exists) {
      return NextResponse.json({ error: "access_denied" }, { status: 403 });
    }

    const source = sourceSnap.data() as Record<string, unknown>;
    const nextId = randomUUID();
    const sourceTitle = String(source.title ?? "").trim();
    const nextTitle = sourceTitle ? `${sourceTitle} (copy)` : "(copy)";

    const nextTrip = {
      ...source,
      id: nextId,
      title: nextTitle,
      ownerUid: uid,
      ownerEmail: email,
      ownerEmailLower: emailLower,
      accessMode: "invited_only",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const nextRef = db.collection("trips").doc(nextId);
    await nextRef.set(nextTrip);
    await nextRef.collection("members").doc(uid).set(
      {
        uid,
        email,
        emailLower,
        role: "member",
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ tripId: nextId });
  } catch (error) {
    console.error("clone api failed", error);
    return NextResponse.json({ error: "clone_failed" }, { status: 500 });
  }
}

