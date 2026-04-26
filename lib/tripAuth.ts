import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  type Auth,
  type User,
} from "firebase/auth";
import {
  ensureAuthPersistence,
  getClientAuth,
  getFirebaseApp,
  getGoogleAuthProvider,
} from "@/lib/firebase";

/** Session restore only (runs in `useEffect`). Never starts OAuth from effects — use `startGoogleSignInForTrip` from a click handler. */
export type TripFirebaseAuthResult =
  | { status: "signed_in" | "skipped"; user: User }
  | { status: "needs_google_sign_in" };

const REDIRECT_ATTEMPTS_KEY = "tripPlanner:googleRedirectAttempts:v1";
/** Set right before `signInWithRedirect` so restore can wait longer for auth to settle after return. */
const OAUTH_RETURN_TRIP_KEY = "tripPlanner:oauthReturnTripId:v1";

function redirectAttemptStorageKey(tripId: string): string {
  return `${REDIRECT_ATTEMPTS_KEY}:${tripId}`;
}

function clearOAuthReturnMarkers(tripId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(redirectAttemptStorageKey(tripId));
    sessionStorage.removeItem(OAUTH_RETURN_TRIP_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * React Strict Mode runs effects twice; only one `getRedirectResult` can consume
 * the pending redirect. Dedupe concurrent restores for the same trip id.
 */
const restoreInflight = new Map<string, Promise<TripFirebaseAuthResult>>();

/** Wait until `onAuthStateChanged` reports a user or timeout (handles post-redirect races). */
async function waitForUser(auth: Auth, maxMs: number): Promise<User | null> {
  if (auth.currentUser) return auth.currentUser;
  if (typeof window === "undefined" || maxMs <= 0) return null;
  return new Promise<User | null>((resolve) => {
    let settled = false;
    const finish = (user: User | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsub();
      resolve(user);
    };
    const timer = window.setTimeout(() => finish(null), maxMs);
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) finish(user);
    });
  });
}

async function runRestoreTripFirebaseSession(
  tripId: string
): Promise<TripFirebaseAuthResult> {
  if (!tripId.trim()) {
    throw new Error("missing_trip_id");
  }
  const app = getFirebaseApp();
  const auth = getClientAuth();
  if (!app || !auth) {
    throw new Error("firebase");
  }

  /**
   * Consume redirect result *before* `setPersistence`. Some environments lose the
   * pending redirect if persistence is reconfigured first.
   */
  try {
    const redirect = await getRedirectResult(auth);
    if (redirect?.user) {
      clearOAuthReturnMarkers(tripId);
      await ensureAuthPersistence();
      return { status: "signed_in", user: redirect.user };
    }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (
      code === "auth/user-cancelled" ||
      code === "auth/cancelled-popup-request"
    ) {
      throw new Error("AUTH_POPUP_BLOCKED");
    }
    throw error;
  }

  await ensureAuthPersistence();

  const authStateReady = (
    auth as unknown as { authStateReady?: () => Promise<void> }
  ).authStateReady;
  if (typeof authStateReady === "function") {
    await authStateReady.call(auth);
  }

  let expectOAuthReturn = false;
  try {
    expectOAuthReturn = sessionStorage.getItem(OAUTH_RETURN_TRIP_KEY) === tripId;
  } catch {
    expectOAuthReturn = false;
  }

  const userFromListener = await waitForUser(
    auth,
    expectOAuthReturn ? 12_000 : 800
  );
  if (userFromListener) {
    clearOAuthReturnMarkers(tripId);
    return {
      status:
        process.env.NEXT_PUBLIC_FIREBASE_AUTH_MODE === "bypass"
          ? "skipped"
          : "signed_in",
      user: userFromListener,
    };
  }

  const current = auth.currentUser;
  if (current) {
    clearOAuthReturnMarkers(tripId);
    return {
      status:
        process.env.NEXT_PUBLIC_FIREBASE_AUTH_MODE === "bypass"
          ? "skipped"
          : "signed_in",
      user: current,
    };
  }

  try {
    sessionStorage.removeItem(OAUTH_RETURN_TRIP_KEY);
  } catch {
    /* ignore */
  }

  if (process.env.NEXT_PUBLIC_FIREBASE_AUTH_MODE === "bypass") {
    throw new Error("AUTH_REQUIRED");
  }

  return { status: "needs_google_sign_in" };
}

/**
 * Resolves the signed-in user after redirect, persisted session, or bypass.
 * If nobody is signed in, returns `needs_google_sign_in` (caller must show a button that calls `startGoogleSignInForTrip`).
 */
export async function restoreTripFirebaseSession(
  tripId: string
): Promise<TripFirebaseAuthResult> {
  const existing = restoreInflight.get(tripId);
  if (existing) {
    return await existing;
  }
  const p = runRestoreTripFirebaseSession(tripId).finally(() => {
    restoreInflight.delete(tripId);
  });
  restoreInflight.set(tripId, p);
  return await p;
}

function shouldUseGooglePopup(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_FIREBASE_AUTH_USE_POPUP === "true") return true;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

function isPopupCancelledError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  return (
    code === "auth/user-cancelled" ||
    code === "auth/cancelled-popup-request" ||
    code === "auth/popup-closed-by-user"
  );
}

/**
 * Call only from a user gesture (button click). Uses `signInWithPopup` on localhost
 * (redirect completion is unreliable in some dev browsers); uses `signInWithRedirect`
 * elsewhere. Set `NEXT_PUBLIC_FIREBASE_AUTH_USE_POPUP=true` to force popup on any host.
 */
export async function startGoogleSignInForTrip(
  tripId: string
): Promise<"popup" | "redirect"> {
  if (!tripId.trim()) throw new Error("missing_trip_id");
  const auth = getClientAuth();
  if (!auth) throw new Error("firebase");

  await ensureAuthPersistence();

  if (shouldUseGooglePopup()) {
    try {
      await signInWithPopup(auth, getGoogleAuthProvider());
    } catch (error) {
      if (isPopupCancelledError(error)) {
        throw new Error("AUTH_POPUP_BLOCKED");
      }
      throw error;
    }
    clearOAuthReturnMarkers(tripId);
    return "popup";
  }

  let attempts = 0;
  try {
    attempts = Number(sessionStorage.getItem(redirectAttemptStorageKey(tripId)) ?? "0");
  } catch {
    attempts = 0;
  }
  if (attempts >= 6) {
    try {
      sessionStorage.removeItem(redirectAttemptStorageKey(tripId));
      sessionStorage.removeItem(OAUTH_RETURN_TRIP_KEY);
    } catch {
      /* ignore */
    }
    throw new Error("AUTH_REDIRECT_LOOP");
  }
  try {
    sessionStorage.setItem(redirectAttemptStorageKey(tripId), String(attempts + 1));
    sessionStorage.setItem(OAUTH_RETURN_TRIP_KEY, tripId);
  } catch {
    /* ignore */
  }

  await signInWithRedirect(auth, getGoogleAuthProvider());
  return "redirect";
}
