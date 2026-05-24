import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

const COLLECTION = process.env.FIRESTORE_PUSH_COLLECTION ?? "pushSubscriptions";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { endpoint?: string };
  const { endpoint } = body;

  if (!endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firestore unavailable" }, { status: 503 });
  }

  await db
    .collection(COLLECTION)
    .doc(endpoint)
    .update({ active: false, unsubscribedAt: new Date() });

  return NextResponse.json({ ok: true });
}
