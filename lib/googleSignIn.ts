import { signInWithPopup, type User } from "firebase/auth";
import {
  ensureAuthPersistence,
  getClientAuth,
  getGoogleAuthProvider,
} from "@/lib/firebase";
import { bootstrapUserOnSignIn } from "@/lib/usersFirestore";

export async function signInWithGoogle(): Promise<User> {
  const auth = getClientAuth();
  if (!auth) throw new Error("Firebase Auth is not configured");
  await ensureAuthPersistence();
  const cred = await signInWithPopup(auth, getGoogleAuthProvider());
  await bootstrapUserOnSignIn(cred.user);
  return cred.user;
}
