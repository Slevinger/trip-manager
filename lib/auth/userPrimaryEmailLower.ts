import type { User } from "firebase/auth";

/**
 * Best-effort lowercase email for Firestore paths and server `fromEmailLower`.
 * Some providers only populate {@link User.providerData}, not {@link User.email}.
 */
export function userPrimaryEmailLower(user: User | null): string | null {
  if (!user) return null;
  const direct = user.email?.trim().toLowerCase();
  if (direct) return direct;
  for (const p of user.providerData ?? []) {
    const e = typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
    if (e) return e;
  }
  return null;
}
