import { OAuth2Client } from "google-auth-library";
import { NextResponse, type NextRequest } from "next/server";

import { requireFirebaseUser } from "@/lib/adminAuth";
import {
  createGmailOAuthClient,
  gmailInboxThreadLink,
  gmailSearchMessages,
  gmailSearchQueryFromTrip,
  normalizeUserEmailKey,
  resolveAppOrigin,
  userGmailCredentialRef,
} from "@/lib/gmailServer";
import {
  canonicalFirestoreDataToTrip,
  canonicalTripDocReadableByUser,
} from "@/lib/canonicalTripsFirestore";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

async function accessTokenFromStoredRefresh(
  oauth2Client: OAuth2Client,
  refreshToken: string
): Promise<string | null> {
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    const t = credentials.access_token;
    return typeof t === "string" && t ? t : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireFirebaseUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.emailLower) {
    return NextResponse.json({ error: "account_email_required" }, { status: 400 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "server_firestore_unconfigured" }, { status: 503 });
  }

  let body: { tripId?: unknown; query?: unknown; maxResults?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const tripId = typeof body.tripId === "string" ? body.tripId.trim() : "";
  if (!tripId) {
    return NextResponse.json({ error: "tripId_required" }, { status: 400 });
  }

  const extraQuery = typeof body.query === "string" ? body.query.trim() : "";
  const maxResults =
    typeof body.maxResults === "number" && Number.isFinite(body.maxResults)
      ? body.maxResults
      : 20;

  const canonicalSnap = await db.collection("canonicalTrips").doc(tripId).get();
  if (!canonicalSnap.exists) {
    return NextResponse.json({ error: "trip_not_found" }, { status: 404 });
  }

  const raw = canonicalSnap.data() as Record<string, unknown>;
  const viewerEmail = normalizeUserEmailKey(auth.emailLower);
  if (!canonicalTripDocReadableByUser(auth.uid, viewerEmail, raw)) {
    return NextResponse.json({ error: "trip_access_denied" }, { status: 403 });
  }

  const trip = canonicalFirestoreDataToTrip(raw);
  const q = gmailSearchQueryFromTrip(trip, extraQuery);

  const credSnap = await userGmailCredentialRef(db, viewerEmail).get();
  if (!credSnap.exists) {
    return NextResponse.json({ error: "gmail_not_connected", query: q }, { status: 400 });
  }

  const refreshToken = credSnap.data()?.refreshToken;
  if (typeof refreshToken !== "string" || !refreshToken) {
    return NextResponse.json({ error: "gmail_not_connected", query: q }, { status: 400 });
  }

  const origin = resolveAppOrigin(req);
  let oauth2Client: OAuth2Client;
  try {
    oauth2Client = createGmailOAuthClient(origin);
  } catch {
    return NextResponse.json({ error: "gmail_oauth_not_configured" }, { status: 503 });
  }

  const accessToken = await accessTokenFromStoredRefresh(oauth2Client, refreshToken);
  if (!accessToken) {
    return NextResponse.json({ error: "gmail_token_refresh_failed" }, { status: 401 });
  }

  let messages;
  try {
    messages = await gmailSearchMessages(accessToken, q, maxResults);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "gmail_search_failed", detail: msg }, { status: 502 });
  }

  return NextResponse.json({
    query: q,
    messages: messages.map((m) => ({
      ...m,
      openInGmailUrl: gmailInboxThreadLink(m.threadId),
    })),
  });
}
