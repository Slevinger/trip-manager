import type { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";

export type AdminAuthResult =
  | { ok: true; emailLower: string; uid: string }
  | { ok: false; status: number; error: string };

export type FirebaseUserAuthResult =
  | { ok: true; emailLower: string; uid: string }
  | { ok: false; status: number; error: string };

function bearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/.exec(h.trim());
  return m?.[1]?.trim() || null;
}

export async function requireAdmin(req: NextRequest): Promise<AdminAuthResult> {
  const auth = getAdminAuth();
  if (!auth) return { ok: false, status: 503, error: "Admin auth not configured" };
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: "Missing Authorization bearer token" };
  try {
    const decoded = await auth.verifyIdToken(token);
    if (decoded.isAdmin !== true) return { ok: false, status: 403, error: "Admin only" };
    const emailLower = String(decoded.email ?? "").trim().toLowerCase();
    if (!emailLower) return { ok: false, status: 401, error: "Token missing email" };
    return { ok: true, emailLower, uid: decoded.uid };
  } catch {
    return { ok: false, status: 401, error: "Invalid auth token" };
  }
}

/** Any signed-in Firebase user (ID token). Used for server routes that enforce access in code. */
export async function requireFirebaseUser(req: NextRequest): Promise<FirebaseUserAuthResult> {
  const auth = getAdminAuth();
  if (!auth) return { ok: false, status: 503, error: "Admin auth not configured" };
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: "Missing Authorization bearer token" };
  try {
    const decoded = await auth.verifyIdToken(token);
    const uid = String(decoded.uid ?? "").trim();
    if (!uid) return { ok: false, status: 401, error: "Token missing uid" };
    const emailLower = String(decoded.email ?? "").trim().toLowerCase();
    return { ok: true, uid, emailLower };
  } catch {
    return { ok: false, status: 401, error: "Invalid auth token" };
  }
}

