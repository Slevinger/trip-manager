import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { requireAdmin } from "@/lib/adminAuth";

function emailLowerFromPath(req: NextRequest): string {
  const parts = req.nextUrl.pathname.split("/");
  const idx = parts.findIndex((p) => p === "user");
  const v = idx >= 0 ? parts[idx + 1] : "";
  return decodeURIComponent(v || "").trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Admin Firestore not configured" }, { status: 503 });

  const emailLower = emailLowerFromPath(req);
  if (!emailLower) return NextResponse.json({ error: "Missing emailLower" }, { status: 400 });

  const col = db.collection("users").doc(emailLower).collection("tripAssistantChats");
  const snap = await col.limit(200).get();
  const chats = snap.docs.map((d) => ({ tripId: d.id, ...(d.data() as Record<string, unknown>) }));
  return NextResponse.json({ chats });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Admin Firestore not configured" }, { status: 503 });
  const emailLower = emailLowerFromPath(req);
  const body = (await req.json().catch(() => null)) as null | { tripId?: string; messages?: unknown[] };
  if (!emailLower || !body?.tripId || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "tripId + messages[] required" }, { status: 400 });
  }
  await db
    .collection("users")
    .doc(emailLower)
    .collection("tripAssistantChats")
    .doc(body.tripId)
    .set({ messages: body.messages }, { merge: true });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Admin Firestore not configured" }, { status: 503 });
  const emailLower = emailLowerFromPath(req);
  const body = (await req.json().catch(() => null)) as null | { tripId?: string };
  if (!emailLower || !body?.tripId) return NextResponse.json({ error: "tripId required" }, { status: 400 });
  await db.collection("users").doc(emailLower).collection("tripAssistantChats").doc(body.tripId).delete();
  return NextResponse.json({ ok: true });
}

