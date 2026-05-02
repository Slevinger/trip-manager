import { signInWithPopup, type User } from "firebase/auth";
import {
  ensureAuthPersistence,
  getClientAuth,
  getGoogleAuthProvider,
} from "@/lib/firebase";

export async function signInWithGoogle(): Promise<User> {
  const auth = getClientAuth();
  if (!auth) throw new Error("Firebase Auth is not configured");
  await ensureAuthPersistence();
  const cred = await signInWithPopup(auth, getGoogleAuthProvider());
  return cred.user;
}
