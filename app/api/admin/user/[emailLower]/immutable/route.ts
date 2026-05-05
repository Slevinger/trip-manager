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

  const tripIdFilter = (req.nextUrl.searchParams.get("tripId") ?? "").trim();
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "");
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(5000, Math.floor(limitParam)) : 2000;

  const col = db
    .collection("users")
    .doc(emailLower)
    .collection("immutableMemoryQueueEntries");

  // With tripId filter use equality only (no composite index needed) and sort in memory.
  // Without filter, fetch newest by seq desc up to `limit`, then return ascending for display.
  let docs: FirebaseFirestore.QueryDocumentSnapshot[];
  if (tripIdFilter) {
    const snap = await col.where("tripId", "==", tripIdFilter).limit(limit).get();
    docs = [...snap.docs];
    docs.sort((a, b) => {
      const sa = Number((a.data() as { seq?: unknown }).seq ?? 0) || 0;
      const sb = Number((b.data() as { seq?: unknown }).seq ?? 0) || 0;
      return sa - sb;
    });
  } else {
    const snap = await col.orderBy("seq", "desc").limit(limit).get();
    docs = [...snap.docs].reverse();
  }

  const entries = docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  return NextResponse.json({ entries, total: entries.length, tripId: tripIdFilter || null, limit });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Admin Firestore not configured" }, { status: 503 });
  const emailLower = emailLowerFromPath(req);
  const body = (await req.json().catch(() => null)) as null | { id?: string; patch?: Record<string, unknown> };
  if (!emailLower || !body?.id || !body.patch) return NextResponse.json({ error: "id + patch required" }, { status: 400 });
  await db
    .collection("users")
    .doc(emailLower)
    .collection("immutableMemoryQueueEntries")
    .doc(body.id)
    .set(body.patch, { merge: true });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Admin Firestore not configured" }, { status: 503 });
  const emailLower = emailLowerFromPath(req);
  const body = (await req.json().catch(() => null)) as null | { id?: string };
  if (!emailLower || !body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db
    .collection("users")
    .doc(emailLower)
    .collection("immutableMemoryQueueEntries")
    .doc(body.id)
    .delete();
  return NextResponse.json({ ok: true });
}

