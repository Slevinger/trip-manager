import { NextResponse } from "next/server";
import * as admin from "firebase-admin";
import { getAdminAuth } from "@/lib/firebase-admin";
import { inviteTokenSecret, verifyInviteToken } from "@/lib/inviteEmailToken";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { token?: string };
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const token = String(body.token ?? "").trim();
  if (!token) {
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  const secret = inviteTokenSecret();
  if (!secret) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const payload = verifyInviteToken(token, secret);
  if (!payload) {
    return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 400 });
  }

  const { tripId, emailLower } = payload;

  try {
    const authAdmin = getAdminAuth();
    const db = admin.firestore();
    const tripRef = db.collection("trips").doc(tripId);
    const tripSnap = await tripRef.get();
    if (!tripSnap.exists) {
      return NextResponse.json({ error: "trip_not_found" }, { status: 404 });
    }

    const inviteRef = tripRef.collection("invites").doc(emailLower);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
      return NextResponse.json({ error: "invite_not_found_or_used" }, { status: 410 });
    }

    const invitedStored = String(
      (inviteSnap.data() as Record<string, unknown>).invitedEmailLower ?? ""
    )
      .trim()
      .toLowerCase();
    if (invitedStored !== emailLower) {
      return NextResponse.json({ error: "invite_mismatch" }, { status: 400 });
    }

    let user: admin.auth.UserRecord;
    try {
      user = await authAdmin.getUserByEmail(emailLower);
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "auth/user-not-found") {
        return NextResponse.json(
          {
            error: "no_firebase_user",
            message:
              "No Google account exists yet for this email. Sign in once with Google using this address, then accept again.",
          },
          { status: 400 }
        );
      }
      throw e;
    }

    const email = (user.email ?? emailLower).trim();
    const memberRef = tripRef.collection("members").doc(user.uid);
    const existingMember = await memberRef.get();
    if (existingMember.exists) {
      await inviteRef.delete().catch(() => undefined);
      const tripTitle = String((tripSnap.data() as Record<string, unknown>).title ?? "");
      return NextResponse.json({
        ok: true,
        tripId,
        tripTitle,
        alreadyMember: true,
      });
    }

    const tokenEmailLower = emailLower;
    const userEmailLower = email.trim().toLowerCase();
    if (userEmailLower !== tokenEmailLower) {
      return NextResponse.json({ error: "email_mismatch" }, { status: 400 });
    }

    await memberRef.set(
      {
        uid: user.uid,
        email,
        emailLower: userEmailLower,
        role: "member",
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await inviteRef.delete();

    const tripTitle = String((tripSnap.data() as Record<string, unknown>).title ?? "");
    return NextResponse.json({
      ok: true,
      tripId,
      tripTitle,
      alreadyMember: false,
    });
  } catch (e) {
    console.error("invite accept", e);
    return NextResponse.json({ error: "accept_failed" }, { status: 500 });
  }
}
