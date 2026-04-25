import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

/** Trim helper — env *names* must be referenced statically so Next.js can inline `NEXT_PUBLIC_*`. */
function trimEnv(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const t = value.trim();
  return t.length ? t : undefined;
}

const firebaseConfig = {
  apiKey: trimEnv(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
  authDomain: trimEnv(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
  projectId: trimEnv(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
  storageBucket: trimEnv(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: trimEnv(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  appId: trimEnv(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
};

function hasConfig(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.projectId &&
      firebaseConfig.appId
  );
}

/** Names of required public env vars that are empty (for error UI). */
export function getMissingFirebasePublicEnv(): string[] {
  const missing: string[] = [];
  if (!trimEnv(process.env.NEXT_PUBLIC_FIREBASE_API_KEY)) {
    missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
  }
  if (!trimEnv(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)) {
    missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  }
  if (!trimEnv(process.env.NEXT_PUBLIC_FIREBASE_APP_ID)) {
    missing.push("NEXT_PUBLIC_FIREBASE_APP_ID");
  }
  return missing;
}

let app: FirebaseApp | undefined;
let firestore: Firestore | undefined;
let auth: Auth | undefined;

export function getFirebaseApp(): FirebaseApp | undefined {
  if (!hasConfig()) return undefined;
  if (!app) {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  }
  return app;
}

/** Firestore instance; undefined when env is not configured. */
export function getDb(): Firestore | undefined {
  if (!hasConfig()) return undefined;
  if (!firestore) {
    const a = getFirebaseApp();
    if (!a) return undefined;
    firestore = getFirestore(a);
  }
  return firestore;
}

export function getClientAuth(): Auth | undefined {
  if (!hasConfig()) return undefined;
  if (!auth) {
    const a = getFirebaseApp();
    if (!a) return undefined;
    auth = getAuth(a);
  }
  return auth;
}

/** Alias for `getDb()`. */
export { getDb as db };
