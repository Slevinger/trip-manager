import { NextResponse } from "next/server";
import * as admin from "firebase-admin";
import { getAdminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const BATCH = 400;

function bearerTokenFromRequest(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/.exec(auth);
  return m?.[1]?.trim() ?? null;
}

async function deleteAllDocsInCollection(
  db: admin.firestore.Firestore,
  coll: admin.firestore.CollectionReference
): Promise<void> {
  const snap = await coll.get();
  for (let i = 0; i < snap.docs.length; i += BATCH) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(i, i + BATCH)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }
}

export async function DELETE(
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
    if (!uid) {
      return NextResponse.json({ error: "auth_required" }, { status: 401 });
    }

    const db = admin.firestore();
    const tripRef = db.collection("trips").doc(tripId);
    const tripSnap = await tripRef.get();
    if (!tripSnap.exists) {
      return NextResponse.json({ error: "trip_not_found" }, { status: 404 });
    }

    const myMember = await tripRef.collection("members").doc(uid).get();
    if (!myMember.exists) {
      return NextResponse.json({ error: "access_denied" }, { status: 403 });
    }

    const membersSnap = await tripRef.collection("members").get();
    if (membersSnap.size !== 1 || membersSnap.docs[0].id !== uid) {
      return NextResponse.json(
        { error: "not_sole_member", memberCount: membersSnap.size },
        { status: 403 }
      );
    }

    await deleteAllDocsInCollection(db, tripRef.collection("invites"));
    await deleteAllDocsInCollection(db, tripRef.collection("members"));
    await tripRef.delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("delete trip failed", error);
    return NextResponse.json({ error: "delete_trip_failed" }, { status: 500 });
  }
}
