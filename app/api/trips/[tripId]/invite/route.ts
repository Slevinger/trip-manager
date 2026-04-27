import { NextResponse } from "next/server";
import * as admin from "firebase-admin";
import { getAdminAuth } from "@/lib/firebase-admin";
import { appOrigin, inviteTokenSecret, signInviteToken } from "@/lib/inviteEmailToken";
import { sendTripInviteEmail } from "@/lib/sendTripInviteEmail";

export const runtime = "nodejs";

function bearerTokenFromRequest(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/.exec(auth);
  return m?.[1]?.trim() ?? null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await context.params;
  if (!tripId?.trim()) {
    return NextResponse.json({ error: "missing_trip_id" }, { status: 400 });
  }

  const bearer = bearerTokenFromRequest(request);
  if (!bearer) {
    return NextResponse.json({ error: "missing_bearer_token" }, { status: 401 });
  }

  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const invitedRaw = String(body.email ?? "").trim();
  const invitedEmailLower = normalizeEmail(invitedRaw);
  if (!invitedEmailLower || !invitedEmailLower.includes("@")) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  try {
    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(bearer);
    const uid = decoded.uid;
    const inviterEmail = typeof decoded.email === "string" ? decoded.email.trim() : "";
    const inviterEmailLower = normalizeEmail(inviterEmail);
    if (!uid || !inviterEmailLower) {
      return NextResponse.json({ error: "auth_email_required" }, { status: 403 });
    }

    const db = admin.firestore();
    const tripRef = db.collection("trips").doc(tripId);
    const memberSnap = await tripRef.collection("members").doc(uid).get();
    if (!memberSnap.exists) {
      return NextResponse.json({ error: "not_a_member" }, { status: 403 });
    }

    const membersSnap = await tripRef.collection("members").get();
    const alreadyMember = membersSnap.docs.some((d) => {
      const em = String((d.data() as Record<string, unknown>).emailLower ?? "").toLowerCase();
      return em === invitedEmailLower;
    });
    if (alreadyMember) {
      return NextResponse.json({ error: "already_member" }, { status: 409 });
    }

    const inviteRef = tripRef.collection("invites").doc(invitedEmailLower);
    await inviteRef.set(
      {
        invitedEmail: invitedRaw,
        invitedEmailLower,
        invitedByUid: uid,
        invitedByEmail: inviterEmail,
        invitedByEmailLower: inviterEmailLower,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        acceptedAt: null,
      },
      { merge: true }
    );

    const tripSnap = await tripRef.get();
    const tripTitle = String((tripSnap.data() as Record<string, unknown> | undefined)?.title ?? "");

    const secret = inviteTokenSecret();
    let emailSent = false;
    let emailNotSentReason:
      | "missing_invite_token_secret"
      | "missing_email_transport"
      | "smtp_failed"
      | "sendgrid_failed"
      | "resend_test_recipient_only"
      | "resend_rejected"
      | undefined;
    let emailNotSentDetail: string | undefined;

    if (!secret) {
      emailNotSentReason = "missing_invite_token_secret";
    } else {
      const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
      const token = signInviteToken({ tripId, emailLower: invitedEmailLower, exp }, secret);
      const acceptPageUrl = `${appOrigin()}/invite/accept?t=${encodeURIComponent(token)}`;
      const send = await sendTripInviteEmail({
        to: invitedRaw,
        tripTitle,
        acceptPageUrl,
      });
      if (send.ok) {
        emailSent = true;
      } else if (send.error === "missing_email_transport") {
        emailNotSentReason = "missing_email_transport";
      } else if (send.error === "smtp_failed") {
        emailNotSentReason = "smtp_failed";
        emailNotSentDetail = send.resendMessage ?? send.error;
      } else if (send.error === "sendgrid_failed") {
        emailNotSentReason = "sendgrid_failed";
        emailNotSentDetail = send.resendMessage ?? send.error;
      } else if (send.error === "resend_test_recipient_only") {
        emailNotSentReason = "resend_test_recipient_only";
      } else {
        emailNotSentReason = "resend_rejected";
        emailNotSentDetail = send.resendMessage ?? send.error;
      }
    }

    return NextResponse.json({
      ok: true,
      emailSent,
      emailNotSentReason: emailSent ? undefined : emailNotSentReason,
      emailNotSentDetail: emailSent ? undefined : emailNotSentDetail,
    });
  } catch (e) {
    console.error("invite api", e);
    return NextResponse.json({ error: "invite_failed" }, { status: 500 });
  }
}
