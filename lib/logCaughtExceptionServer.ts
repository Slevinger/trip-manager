import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

/**
 * Fire-and-forget: logs a caught (silenced) exception to the `caught_exceptions`
 * Firestore collection via the Admin SDK. Safe to call from any server catch block
 * — never throws.
 *
 * Server-side only. For browser code use `logCaughtException`.
 */
export function logCaughtExceptionServer(
  error: unknown,
  context: string,
  extra?: Record<string, unknown>
): void {
  try {
    const db = getAdminFirestore();
    if (!db) return;
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    const stack =
      error instanceof Error && error.stack
        ? error.stack.slice(0, 3000)
        : undefined;
    void db.collection("caught_exceptions").add({
      message,
      context,
      env: "server",
      ...(stack ? { stack } : {}),
      ...(extra && Object.keys(extra).length ? { extra } : {}),
      ts: FieldValue.serverTimestamp(),
    });
  } catch {
    // Never let the logger itself throw or recurse.
  }
}
