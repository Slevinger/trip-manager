import { NextResponse, type NextRequest } from "next/server";

import { requireFirebaseUser } from "@/lib/adminAuth";
import { normalizeUserEmailKey, userGmailCredentialRef } from "@/lib/gmailServer";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

export async function GET(req: NextRequest) {
  const auth = await requireFirebaseUser(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.emailLower) {
    return NextResponse.json({ connected: false, googleEmail: null as string | null });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "server_firestore_unconfigured" }, { status: 503 });
  }

  const emailLower = normalizeUserEmailKey(auth.emailLower);
  const credSnap = await userGmailCredentialRef(db, emailLower).get();
  const userSnap = await db.collection("users").doc(emailLower).get();
  const udata = userSnap.data() as Record<string, unknown> | undefined;
  const gr = udata?.gmailReadOnly;
  let googleEmail: string | null = null;
  if (gr && typeof gr === "object" && !Array.isArray(gr)) {
    const ge = (gr as Record<string, unknown>).googleEmail;
    googleEmail = typeof ge === "string" && ge.trim() ? ge.trim() : null;
  }

  return NextResponse.json({
    connected: credSnap.exists,
    googleEmail,
  });
}
