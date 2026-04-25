import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** UID must be valid for Firebase Auth (alphanumeric and limited punctuation). */
function uidForTrip(tripId: string): string {
  const safe = tripId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `tg_${safe}`.slice(0, 128);
}

/**
 * Mints a Firebase custom token so the browser client can sign in and use
 * Firestore under security rules that require authentication.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await context.params;
  if (!tripId?.trim()) {
    return NextResponse.json({ error: "missing_trip_id" }, { status: 400 });
  }

  const { getAdminAuth, isFirebaseAdminConfigured } = await import(
    "@/lib/firebase-admin"
  );

  if (!isFirebaseAdminConfigured()) {
    return NextResponse.json(
      { error: "admin_not_configured" },
      { status: 501 }
    );
  }

  try {
    const auth = getAdminAuth();
    const uid = uidForTrip(tripId);
    const token = await auth.createCustomToken(uid, { tripId });
    return NextResponse.json({ token });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
