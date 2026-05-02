import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  getAuth,
  setPersistence,
  type Auth,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

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
    firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
  );
}

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
let storage: FirebaseStorage | undefined;
let auth: Auth | undefined;
let authPersistenceReady: Promise<void> | null = null;
let googleProvider: GoogleAuthProvider | undefined;

export async function ensureAuthPersistence(): Promise<void> {
  if (typeof window === "undefined") return;
  const a = getClientAuth();
  if (!a) return;
  if (!authPersistenceReady) {
    authPersistenceReady = setPersistence(a, browserLocalPersistence).catch(() => {});
  }
  await authPersistenceReady;
}

export function getFirebaseApp(): FirebaseApp | undefined {
  if (!hasConfig()) return undefined;
  if (!app) {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  }
  return app;
}

export function getDb(): Firestore | undefined {
  if (!hasConfig()) return undefined;
  if (!firestore) {
    const a = getFirebaseApp();
    if (!a) return undefined;
    firestore = getFirestore(a);
  }
  return firestore;
}

/** Storage client; undefined when Firebase env is incomplete. */
export function getClientStorage(): FirebaseStorage | undefined {
  if (!hasConfig()) return undefined;
  if (!storage) {
    const a = getFirebaseApp();
    if (!a) return undefined;
    storage = getStorage(a);
  }
  return storage;
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

export function getGoogleAuthProvider(): GoogleAuthProvider {
  if (!googleProvider) {
    googleProvider = new GoogleAuthProvider();
    googleProvider.addScope("email");
    googleProvider.addScope("profile");
    googleProvider.setCustomParameters({ prompt: "select_account" });
  }
  return googleProvider;
}
