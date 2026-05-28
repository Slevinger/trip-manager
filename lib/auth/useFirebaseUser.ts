"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getClientAuth, getDb, getMissingFirebasePublicEnv } from "@/lib/firebase";

/** Returns the current Firebase user (null if signed out) and whether auth has resolved. */
export function useFirebaseUser(): { user: User | null; ready: boolean; useFirestore: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const useFirestore = Boolean(getDb() && getMissingFirebasePublicEnv().length === 0);

  useEffect(() => {
    const auth = getClientAuth();
    if (!auth) {
      setReady(true);
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setReady(true);
    });
  }, []);

  return { user, ready, useFirestore };
}
