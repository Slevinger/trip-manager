"use client";

import type { User } from "firebase/auth";
import { onAuthStateChanged, signOut } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteCanonicalTrip,
  saveCanonicalTrip,
  sessionIsGoogleSignIn,
  subscribeMyCanonicalTrips,
} from "@/lib/canonicalTripsFirestore";
import { getClientAuth, getDb, getMissingFirebasePublicEnv } from "@/lib/firebase";
import { signInWithGoogle } from "@/lib/googleSignIn";
import {
  createNewTrip,
  deleteTrip as deleteLocalTrip,
  ensureSeedTrip,
  listTrips as listLocalTrips,
  putTrip as putLocalTrip,
} from "@/lib/tripLocalStore";
import type { Trip } from "@/lib/types/trip";

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);

  const missingEnv = useMemo(() => getMissingFirebasePublicEnv(), []);
  const db = getDb();
  const useFirestore = Boolean(db && missingEnv.length === 0);

  useEffect(() => {
    const auth = getClientAuth();
    if (!auth) {
      setAuthReady(true);
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

  const refreshLocal = useCallback(() => {
    ensureSeedTrip();
    setTrips(listLocalTrips());
  }, []);

  useEffect(() => {
    if (!useFirestore || !user || !db) return undefined;
    let cancelled = false;
    let unsub: (() => void) | undefined;
    void (async () => {
      const google = await sessionIsGoogleSignIn(user);
      if (cancelled) return;
      if (!google) {
        setTrips([]);
        return;
      }
      setError(null);
      unsub = subscribeMyCanonicalTrips(
        db,
        user,
        (list) => setTrips(list),
        (e) => setError(e.message)
      );
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [useFirestore, user, db]);

  useEffect(() => {
    if (useFirestore && user) return;
    if (useFirestore && !user) {
      setTrips([]);
      return;
    }
    refreshLocal();
    setTrips(listLocalTrips());
  }, [useFirestore, user, refreshLocal]);

  async function handleNew() {
    setError(null);
    try {
      if (useFirestore && user && db && (await sessionIsGoogleSignIn(user))) {
        const t = createNewTrip();
        await saveCanonicalTrip(db, t, user);
        router.push(`/trip/${t.id}`);
        return;
      }
      const t = createNewTrip();
      putLocalTrip(t);
      refreshLocal();
      router.push(`/trip/${t.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(trip: Trip, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this trip?")) return;
    setError(null);
    try {
      if (useFirestore && user && db && (await sessionIsGoogleSignIn(user))) {
        await deleteCanonicalTrip(db, trip.id, user);
        return;
      }
      deleteLocalTrip(trip.id);
      refreshLocal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSignIn() {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSignOut() {
    const auth = getClientAuth();
    if (auth) await signOut(auth);
  }

  if (!authReady) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-zinc-500">
        Loading…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {missingEnv.length > 0 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          Firebase env not set — trips are stored in <strong>localStorage</strong> only. Copy{" "}
          <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">NEXT_PUBLIC_FIREBASE_*</code> from the
          root app&apos;s <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">.env.local</code> into{" "}
          <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">planner-next/.env.local</code>, then
          restart dev. Deploy updated <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">firestore.rules</code> for{" "}
          <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">canonicalTrips</code>.
        </p>
      ) : (
        <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200">
          Cloud: Firestore collection <code className="font-mono">canonicalTrips</code> (per signed-in user).
          {!user ? " Sign in to sync." : null}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Trips</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Open a trip → <strong>View</strong> or <strong>Manage</strong> (JSON).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {useFirestore && !user ? (
            <button
              type="button"
              onClick={() => void handleSignIn()}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
            >
              Sign in with Google
            </button>
          ) : null}
          {useFirestore && user ? (
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="rounded-xl border border-zinc-300 px-3 py-2 text-xs dark:border-zinc-600"
            >
              Sign out ({user.email ?? user.uid})
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleNew()}
            disabled={useFirestore && !user}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            New trip
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      <ul className="mt-8 space-y-2">
        {trips.map((t) => (
          <li key={t.id}>
            <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <Link
                href={`/trip/${t.id}`}
                className="min-w-0 flex-1 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900/80"
              >
                <span className="font-medium text-zinc-900 dark:text-zinc-50">{t.title}</span>
                <span className="mt-0.5 block truncate font-mono text-xs text-zinc-500">
                  {t.id} · {t.steps.length} steps
                </span>
              </Link>
              <button
                type="button"
                onClick={(e) => void handleDelete(t, e)}
                className="shrink-0 rounded-lg px-3 py-2 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {trips.length === 0 && (!useFirestore || user) ? (
        <p className="mt-8 text-sm text-zinc-500">
          No trips yet. {!useFirestore || user ? "Click “New trip”." : "Sign in, then create one."}
        </p>
      ) : null}
    </main>
  );
}
