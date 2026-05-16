"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

/**
 * Fire-and-forget: logs a caught (silenced) exception to the `caught_exceptions`
 * Firestore collection. Safe to call from any catch block — never throws.
 *
 * Client-side only. For server/API routes use `logCaughtExceptionServer`.
 */
export function logCaughtException(
  error: unknown,
  context: string,
  extra?: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  try {
    const db = getDb();
    if (!db) return;
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    const stack =
      error instanceof Error && error.stack
        ? error.stack.slice(0, 3000)
        : undefined;
    void addDoc(collection(db, "caught_exceptions"), {
      message,
      context,
      env: "client",
      url: window.location.href,
      ...(stack ? { stack } : {}),
      ...(extra && Object.keys(extra).length ? { extra } : {}),
      ts: serverTimestamp(),
    });
  } catch {
    // Never let the logger itself throw or recurse.
  }
}
