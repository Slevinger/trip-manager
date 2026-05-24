import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

const COLLECTION = process.env.FIRESTORE_PUSH_COLLECTION ?? "pushSubscriptions";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    userId?: string;
    subscription?: { endpoint?: string; keys?: unknown };
  };

  const { userId, subscription } = body;
  if (!userId || !subscription?.endpoint) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firestore unavailable" }, { status: 503 });
  }

  await db.collection(COLLECTION).doc(subscription.endpoint).set({
    userId,
    subscription,
    active: true,
    createdAt: new Date(),
  });

  return NextResponse.json({ ok: true });
}
