import { FieldValue } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";
import { logCaughtExceptionServer } from "@/lib/logCaughtExceptionServer";

import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
  createGmailOAuthClient,
  GMAIL_OAUTH_STATE_COLLECTION,
  normalizeUserEmailKey,
  resolveAppOrigin,
  userGmailCredentialRef,
} from "@/lib/gmailServer";

export async function GET(req: NextRequest) {
  const db = getAdminFirestore();
  const origin = resolveAppOrigin(req);
  const fallbackBase = new URL("/", origin);

  const fail = (code: string) => {
    const u = new URL(fallbackBase);
    u.searchParams.set("gmail_error", code);
    return NextResponse.redirect(u);
  };

  if (!db) return fail("server");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthErr = req.nextUrl.searchParams.get("error");
  if (oauthErr) return fail(oauthErr);
  if (!code?.trim() || !state?.trim()) return fail("missing_params");

  const stateRef = db.collection(GMAIL_OAUTH_STATE_COLLECTION).doc(state.trim());
  const stateSnap = await stateRef.get();
  if (!stateSnap.exists) return fail("invalid_state");

  const sd = stateSnap.data() as { emailLower?: string; returnPath?: string };
  const emailLower = normalizeUserEmailKey(String(sd.emailLower ?? ""));
  if (!emailLower) {
    await stateRef.delete().catch(() => {});
    return fail("invalid_state");
  }

  const returnPath =
    typeof sd.returnPath === "string" && sd.returnPath.startsWith("/") && !sd.returnPath.startsWith("//")
      ? sd.returnPath
      : "/";

  let client;
  try {
    client = createGmailOAuthClient(origin);
  } catch {
    await stateRef.delete().catch(() => {});
    return fail("config");
  }

  let tokens: {
    refresh_token?: string | null;
    access_token?: string | null;
    scope?: string | null;
  };
  try {
    const exchanged = await client.getToken(code.trim());
    tokens = exchanged.tokens;
  } catch {
    await stateRef.delete().catch(() => {});
    return fail("token_exchange");
  }

  const refreshToken = tokens.refresh_token;
  if (!refreshToken || typeof refreshToken !== "string") {
    await stateRef.delete().catch(() => {});
    const u = new URL(returnPath, origin);
    u.searchParams.set("gmail_error", "no_refresh");
    return NextResponse.redirect(u);
  }

  let googleEmail = "";
  try {
    const at = tokens.access_token;
    if (typeof at === "string" && at) {
      const ui = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${at}` },
      });
      if (ui.ok) {
        const j = (await ui.json()) as { email?: string };
        googleEmail = typeof j.email === "string" ? j.email.trim() : "";
      }
    }
  } catch (e) {
    logCaughtExceptionServer(e, "gmailCallbackRoute/oauthUserinfo");
  }

  await userGmailCredentialRef(db, emailLower).set({
    refreshToken,
    scope: typeof tokens.scope === "string" ? tokens.scope : "",
    updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection("users").doc(emailLower).set(
    {
      gmailReadOnly: {
        connectedAt: new Date().toISOString(),
        ...(googleEmail ? { googleEmail } : {}),
      },
    },
    { merge: true }
  );

  await stateRef.delete().catch(() => {});

  const ok = new URL(returnPath, origin);
  ok.searchParams.set("gmail_connected", "1");
  return NextResponse.redirect(ok);
}
