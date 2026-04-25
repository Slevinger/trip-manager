import { signInWithCustomToken } from "firebase/auth";
import { getClientAuth, getFirebaseApp } from "@/lib/firebase";

export type TripFirebaseAuthResult = "signed_in" | "admin_missing" | "skipped";

/**
 * Signs the browser into Firebase using a custom token minted by the server
 * (Firebase Admin + service account). Required when Firestore rules deny
 * anonymous access.
 */
export async function ensureTripFirebaseAuth(
  tripId: string
): Promise<TripFirebaseAuthResult> {
  if (process.env.NEXT_PUBLIC_FIREBASE_AUTH_MODE === "bypass") {
    return "skipped";
  }

  const app = getFirebaseApp();
  const auth = getClientAuth();
  if (!app || !auth) {
    return "admin_missing";
  }

  const res = await fetch(
    `/api/trips/${encodeURIComponent(tripId)}/auth-token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }
  );

  if (res.status === 501) {
    return "admin_missing";
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }

  const data = (await res.json()) as { token?: string };
  if (!data.token) {
    throw new Error("missing_token");
  }

  await signInWithCustomToken(auth, data.token);
  return "signed_in";
}
