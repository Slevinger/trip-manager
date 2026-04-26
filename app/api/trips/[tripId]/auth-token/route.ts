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
  return NextResponse.json(
    {
      error: "deprecated",
      message: "Custom per-trip tokens are deprecated. Use Google sign-in on client.",
      legacyUid: uidForTrip(tripId),
    },
    { status: 410 }
  );
}
