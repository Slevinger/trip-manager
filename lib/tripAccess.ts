import {
  collection,
  doc,
  getDoc,
  getDocs,
  type FirestoreError,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { getDb } from "@/lib/firebase";
import { getTripRef } from "@/lib/trips";

export type TripMemberRole = "member";

export type TripMember = {
  uid: string;
  email: string;
  emailLower: string;
  role: TripMemberRole;
  joinedAt: string;
};

export type TripInvite = {
  id: string;
  invitedEmail: string;
  invitedEmailLower: string;
  invitedByUid: string;
  invitedByEmail: string;
  invitedByEmailLower: string;
  createdAt: string;
  acceptedAt?: string;
};

const TRIPS = "trips";
const MEMBERS = "members";
const INVITES = "invites";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isPermissionDenied(error: unknown): boolean {
  const e = error as FirestoreError | undefined;
  return e?.code === "permission-denied";
}

/**
 * Right after OAuth, Firestore can briefly evaluate requests before the fresh
 * ID token is attached. Retry once after forcing token refresh.
 */
async function withAuthRetry<T>(user: User, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (!isPermissionDenied(error)) throw error;
  }
  try {
    await user.getIdToken(true);
  } catch {
    /* ignore token refresh failures and surface original firestore result */
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  try {
    return await op();
  } catch (error) {
    if (isPermissionDenied(error)) {
      throw new Error("FIRESTORE_READ_DENIED");
    }
    throw error;
  }
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("firebase");
  return db;
}

export function getTripMemberRef(tripId: string, uid: string) {
  return doc(requireDb(), TRIPS, tripId, MEMBERS, uid);
}

export function getTripMembersCollectionRef(tripId: string) {
  return collection(requireDb(), TRIPS, tripId, MEMBERS);
}

export function getTripInviteRef(tripId: string, invitedEmailLower: string) {
  return doc(requireDb(), TRIPS, tripId, INVITES, invitedEmailLower);
}

export function getTripInvitesCollectionRef(tripId: string) {
  return collection(requireDb(), TRIPS, tripId, INVITES);
}

export async function listTripMembers(tripId: string): Promise<TripMember[]> {
  const snap = await getDocs(getTripMembersCollectionRef(tripId));
  return snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    return {
      uid: d.id,
      email: String(raw.email ?? ""),
      emailLower: String(raw.emailLower ?? ""),
      role: "member",
      joinedAt: String(raw.joinedAt ?? ""),
    };
  });
}

export async function listTripInvites(tripId: string): Promise<TripInvite[]> {
  const snap = await getDocs(getTripInvitesCollectionRef(tripId));
  return snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      invitedEmail: String(raw.invitedEmail ?? ""),
      invitedEmailLower: String(raw.invitedEmailLower ?? d.id),
      invitedByUid: String(raw.invitedByUid ?? ""),
      invitedByEmail: String(raw.invitedByEmail ?? ""),
      invitedByEmailLower: String(raw.invitedByEmailLower ?? ""),
      createdAt: String(raw.createdAt ?? ""),
      acceptedAt:
        typeof raw.acceptedAt === "string" && raw.acceptedAt.trim()
          ? raw.acceptedAt
          : undefined,
    };
  });
}

export async function createTripInvite(
  tripId: string,
  invitedEmail: string,
  invitedBy: { uid: string; email: string }
): Promise<void> {
  const invitedEmailLower = normalizeEmail(invitedEmail);
  const invitedByEmailLower = normalizeEmail(invitedBy.email);
  if (!invitedEmailLower || !invitedByEmailLower) {
    throw new Error("invalid_email");
  }
  const ref = getTripInviteRef(tripId, invitedEmailLower);
  await setDoc(
    ref,
    {
      invitedEmail: invitedEmail.trim(),
      invitedEmailLower,
      invitedByUid: invitedBy.uid,
      invitedByEmail: invitedBy.email,
      invitedByEmailLower,
      createdAt: serverTimestamp(),
      acceptedAt: null,
    },
    { merge: true }
  );
}

export async function ensureTripAccessForUser(
  tripId: string,
  user: User
): Promise<{ member: TripMember | null; accessDenied: boolean }> {
  const email = user.email?.trim();
  const emailLower = normalizeEmail(email ?? "");
  if (!email || !emailLower) {
    throw new Error("AUTH_EMAIL_REQUIRED");
  }

  const memberRef = getTripMemberRef(tripId, user.uid);
  const memberSnap = await withAuthRetry(user, () => getDoc(memberRef));
  if (memberSnap.exists()) {
    return {
      member: {
        uid: user.uid,
        email,
        emailLower,
        role: "member",
        joinedAt: String(
          (memberSnap.data() as Record<string, unknown>).joinedAt ?? ""
        ),
      },
      accessDenied: false,
    };
  }

  const inviteRef = getTripInviteRef(tripId, emailLower);
  const inviteSnap = await withAuthRetry(user, () => getDoc(inviteRef));
  if (inviteSnap.exists()) {
    await withAuthRetry(user, async () => {
      await setDoc(
        memberRef,
        {
          uid: user.uid,
          email,
          emailLower,
          role: "member",
          joinedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await updateDoc(inviteRef, { acceptedAt: serverTimestamp() });
    });
    return {
      member: {
        uid: user.uid,
        email,
        emailLower,
        role: "member",
        joinedAt: new Date().toISOString(),
      },
      accessDenied: false,
    };
  }

  const tripRef = getTripRef(tripId);
  const tripSnap = await withAuthRetry(user, () => getDoc(tripRef));
  if (!tripSnap.exists()) {
    await withAuthRetry(user, async () => {
      await setDoc(
        tripRef,
        {
          id: tripId,
          title: "",
          tripStart: "",
          managePassword: "",
          ownerUid: user.uid,
          ownerEmail: email,
          ownerEmailLower: emailLower,
          accessMode: "invited_only",
          tripAttachments: [],
          smartTimeline: true,
          autoCurrentByDate: true,
          steps: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await setDoc(
        memberRef,
        {
          uid: user.uid,
          email,
          emailLower,
          role: "member",
          joinedAt: serverTimestamp(),
        },
        { merge: true }
      );
    });
    return {
      member: {
        uid: user.uid,
        email,
        emailLower,
        role: "member",
        joinedAt: new Date().toISOString(),
      },
      accessDenied: false,
    };
  }

  const tripData = tripSnap.data() as Record<string, unknown>;
  const hasOwner = typeof tripData.ownerUid === "string" && tripData.ownerUid.trim() !== "";
  if (!hasOwner) {
    await withAuthRetry(user, async () => {
      await setDoc(
        memberRef,
        {
          uid: user.uid,
          email,
          emailLower,
          role: "member",
          joinedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await setDoc(
        tripRef,
        {
          ownerUid: user.uid,
          ownerEmail: email,
          ownerEmailLower: emailLower,
          accessMode: "invited_only",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    });
    return {
      member: {
        uid: user.uid,
        email,
        emailLower,
        role: "member",
        joinedAt: new Date().toISOString(),
      },
      accessDenied: false,
    };
  }

  const ownerUid = String(tripData.ownerUid ?? "").trim();
  if (ownerUid === user.uid) {
    await withAuthRetry(user, () =>
      setDoc(
        memberRef,
        {
          uid: user.uid,
          email,
          emailLower,
          role: "member",
          joinedAt: serverTimestamp(),
        },
        { merge: true }
      )
    );
    return {
      member: {
        uid: user.uid,
        email,
        emailLower,
        role: "member",
        joinedAt: new Date().toISOString(),
      },
      accessDenied: false,
    };
  }

  return { member: null, accessDenied: true };
}
