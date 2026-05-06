import { FieldValue } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";

import { requireFirebaseUser } from "@/lib/adminAuth";
import { normalizeUserEmailKey, userGmailCredentialRef } from "@/lib/gmailServer";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

export async function POST(request: NextRequest) {
  const auth = await requireFirebaseUser(request);
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

  const emailLower = normalizeUserEmailKey(auth.emailLower);
  await userGmailCredentialRef(db, emailLower).delete().catch(() => {});
  try {
    await db.collection("users").doc(emailLower).update({
      gmailReadOnly: FieldValue.delete(),
    });
  } catch {
    /* profile doc may not exist */
  }

  return NextResponse.json({ ok: true });
}
