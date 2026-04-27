import { NextResponse } from "next/server";
import * as admin from "firebase-admin";
import { getAdminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";

function bearerTokenFromRequest(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/.exec(auth);
  return m?.[1]?.trim() ?? null;
}

type TripListRow = {
  id: string;
  title: string;
  joinedAt?: string;
  /** True when this user is the only `members/{uid}` document (may delete trip). */
  canDeleteSole: boolean;
};

function isFailedPrecondition(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    Number((error as { code?: unknown }).code) === 9
  );
}

export async function GET(request: Request) {
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

    let rows: TripListRow[] = [];
    try {
      const membersSnap = await db
        .collectionGroup("members")
        .where("uid", "==", uid)
        .get();

      const refs = membersSnap.docs
        .map((d) => d.ref.parent.parent)
        .filter((r): r is NonNullable<typeof r> => Boolean(r));

      const fetched = await Promise.all(
        refs.map(async (ref) => {
          const trip = await ref.get();
          if (!trip.exists) return null;
          const raw = trip.data() as Record<string, unknown>;
          const member = membersSnap.docs.find((m) => m.ref.parent.parent?.id === ref.id);
          const joinedRaw = member?.data().joinedAt as
            | admin.firestore.Timestamp
            | string
            | undefined;
          const joinedAt =
            typeof joinedRaw === "string"
              ? joinedRaw
              : joinedRaw instanceof admin.firestore.Timestamp
                ? joinedRaw.toDate().toISOString()
                : undefined;
          const allMembers = await ref.collection("members").get();
          const canDeleteSole =
            allMembers.size === 1 && allMembers.docs[0]?.id === uid;
          const row: TripListRow = {
            id: ref.id,
            title: String(raw.title ?? "").trim(),
            canDeleteSole,
          };
          if (joinedAt !== undefined) row.joinedAt = joinedAt;
          return row;
        })
      );
      rows = fetched.filter((r): r is TripListRow => r !== null);
    } catch (error) {
      if (!isFailedPrecondition(error)) throw error;
      // Fallback for environments missing collectionGroup index.
      const tripsSnap = await db.collection("trips").get();
      const fetched = await Promise.all(
        tripsSnap.docs.map(async (tripDoc) => {
          const memberDoc = await tripDoc.ref.collection("members").doc(uid).get();
          if (!memberDoc.exists) return null;
          const raw = tripDoc.data() as Record<string, unknown>;
          const joinedRaw = memberDoc.data()?.joinedAt as
            | admin.firestore.Timestamp
            | string
            | undefined;
          const joinedAt =
            typeof joinedRaw === "string"
              ? joinedRaw
              : joinedRaw instanceof admin.firestore.Timestamp
                ? joinedRaw.toDate().toISOString()
                : undefined;
          const allMembers = await tripDoc.ref.collection("members").get();
          const canDeleteSole =
            allMembers.size === 1 && allMembers.docs[0]?.id === uid;
          const row: TripListRow = {
            id: tripDoc.id,
            title: String(raw.title ?? "").trim(),
            canDeleteSole,
          };
          if (joinedAt !== undefined) row.joinedAt = joinedAt;
          return row;
        })
      );
      rows = fetched.filter((r): r is TripListRow => r !== null);
    }

    return NextResponse.json({
      trips: rows,
    });
  } catch (error) {
    console.error("list mine trips failed", error);
    return NextResponse.json({ error: "list_trips_failed" }, { status: 500 });
  }
}

