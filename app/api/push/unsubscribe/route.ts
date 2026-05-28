import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

const COLLECTION = process.env.FIRESTORE_PUSH_COLLECTION ?? "pushSubscriptions";

function endpointDocId(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}

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
    .doc(endpointDocId(endpoint))
    .update({ active: false, unsubscribedAt: new Date() });

  return NextResponse.json({ ok: true });
}
