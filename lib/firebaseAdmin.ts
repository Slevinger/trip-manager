import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

function adminApp() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const cred = JSON.parse(raw) as ServiceAccount;
    return getApps()[0] ?? initializeApp({ credential: cert(cred) });
  } catch (e) {
    console.warn("[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT_JSON invalid — Admin disabled.", e);
    return null;
  }
}

/**
 * Server-only Firestore (Admin SDK). Bypasses security rules.
 * Set `FIREBASE_SERVICE_ACCOUNT_JSON` to the full JSON string of a service account key
 * with permission to write Firestore (e.g. Editor or a custom role with datastore writes).
 */
export function getAdminFirestore(): Firestore | null {
  const app = adminApp();
  if (!app) return null;
  return getFirestore(app);
}

export function getAdminAuth(): Auth | null {
  const app = adminApp();
  if (!app) return null;
  return getAuth(app);
}
