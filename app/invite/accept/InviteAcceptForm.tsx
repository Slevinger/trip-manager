"use client";

import { useState } from "react";

export function InviteAcceptForm({ token }: { token: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function accept() {
    setStatus("loading");
    setMessage(null);
    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        ok?: boolean;
        tripId?: string;
        alreadyMember?: boolean;
      };

      if (!res.ok) {
        setStatus("error");
        setMessage(
          data.message ||
            (data.error === "no_firebase_user"
              ? "Create a Google account with this email (sign in once), then try again."
              : data.error === "invalid_or_expired_token"
                ? "This link is invalid or has expired. Ask for a new invite."
                : data.error === "invite_not_found_or_used"
                  ? "This invite was already used or removed."
                  : "Something went wrong. Try again or open the trip from the app.")
        );
        return;
      }

      if (data.ok && data.tripId) {
        setStatus("done");
        window.location.href = `/trip/${data.tripId}`;
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Try again.");
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Trip invitation
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Accept to join this trip as a member. You must use a Google account whose email matches
        the address that was invited.
      </p>
      {status === "error" && message ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {message}
        </p>
      ) : null}
      {status === "done" ? (
        <p className="text-sm text-zinc-600">Redirecting…</p>
      ) : (
        <button
          type="button"
          disabled={status === "loading"}
          onClick={() => void accept()}
          className="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900"
        >
          {status === "loading" ? "Working…" : "Accept invitation"}
        </button>
      )}
    </div>
  );
}
