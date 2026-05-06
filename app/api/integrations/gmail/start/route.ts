import { randomUUID } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";

import { requireFirebaseUser } from "@/lib/adminAuth";
import {
  createGmailOAuthClient,
  GMAIL_OAUTH_STATE_COLLECTION,
  GMAIL_READONLY_SCOPE,
  resolveAppOrigin,
  sanitizeOAuthReturnPath,
} from "@/lib/gmailServer";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

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

  let body: { returnPath?: unknown } = {};
  try {
    body = (await req.json()) as { returnPath?: unknown };
  } catch {
    body = {};
  }
  const returnPath =
    typeof body.returnPath === "string" ? sanitizeOAuthReturnPath(body.returnPath, "/") : "/";

  const origin = resolveAppOrigin(req);
  let oauth2Client;
  try {
    oauth2Client = createGmailOAuthClient(origin);
  } catch {
    return NextResponse.json({ error: "gmail_oauth_not_configured" }, { status: 503 });
  }

  const stateId = randomUUID();
  await db.collection(GMAIL_OAUTH_STATE_COLLECTION).doc(stateId).set({
    uid: auth.uid,
    emailLower: auth.emailLower,
    returnPath,
    createdAt: FieldValue.serverTimestamp(),
  });

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_READONLY_SCOPE],
    state: stateId,
  });

  return NextResponse.json({ url });
}
