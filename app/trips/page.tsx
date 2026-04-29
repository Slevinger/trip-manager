"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { ensureAuthPersistence, getClientAuth } from "@/lib/firebase";
import { restoreTripFirebaseSession, startGoogleSignInForTrip } from "@/lib/tripAuth";

const INDEX_AUTH_ID = "__trips_index__";

type TripRow = {
  id: string;
  title: string;
  joinedAt?: string;
  canDeleteSole?: boolean;
  hasLocalSnapshot?: boolean;
};

const TRIP_LOCAL_SNAPSHOT_PREFIX = "trip-doc-snapshot:";

function readLocalTripRows(): TripRow[] {
  if (typeof window === "undefined") return [];
  const rows: TripRow[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(TRIP_LOCAL_SNAPSHOT_PREFIX)) continue;
      const tripId = key.slice(TRIP_LOCAL_SNAPSHOT_PREFIX.length).trim();
      if (!tripId) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as {
        savedAt?: string;
        trip?: { title?: string };
      };
      rows.push({
        id: tripId,
        title: typeof parsed.trip?.title === "string" ? parsed.trip.title : "",
        joinedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : undefined,
        canDeleteSole: false,
        hasLocalSnapshot: true,
      });
    }
  } catch {
    return rows;
  }
  return rows;
}

function mergeTripRows(remoteRows: TripRow[], localRows: TripRow[]): TripRow[] {
  const byId = new Map<string, TripRow>();
  for (const row of remoteRows) byId.set(row.id, row);
  for (const local of localRows) {
    const existing = byId.get(local.id);
    if (!existing) {
      byId.set(local.id, local);
      continue;
    }
    byId.set(local.id, {
      ...existing,
      title: existing.title || local.title,
      joinedAt: existing.joinedAt || local.joinedAt,
      hasLocalSnapshot: true,
    });
  }
  return [...byId.values()];
}

function removeLocalTripSnapshot(tripId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${TRIP_LOCAL_SNAPSHOT_PREFIX}${tripId}`);
  } catch {
    /* ignore localStorage errors */
  }
}

export default function TripsPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [rows, setRows] = useState<TripRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadTrips = useCallback(async () => {
    setError(null);
    const localRows = readLocalTripRows();
    await ensureAuthPersistence();
    const auth = await restoreTripFirebaseSession(INDEX_AUTH_ID);
    if (auth.status === "needs_google_sign_in") {
      setNeedsSignIn(true);
      setRows(localRows);
      return;
    }
    if (!auth.user) throw new Error("firebase");
    const token = await auth.user.getIdToken();
    const res = await fetch("/api/trips/mine", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`list_trips_failed_${res.status}`);
    const payload = (await res.json()) as { trips?: TripRow[] };
    setNeedsSignIn(false);
    const remoteRows = Array.isArray(payload.trips) ? payload.trips : [];
    setRows(mergeTripRows(remoteRows, localRows));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await loadTrips();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTrips]);

  const deleteTrip = useCallback(
    async (tripId: string) => {
      if (!window.confirm(t("trips.deleteConfirm"))) return;
      const auth = getClientAuth();
      const user = auth?.currentUser;
      if (!user) {
        setError(t("trips.deleteFailed"));
        return;
      }
      setDeletingId(tripId);
      setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `delete_${res.status}`);
        }
        setRows((prev) => prev.filter((r) => r.id !== tripId));
      } catch (e) {
        setError(
          `${t("trips.deleteFailed")}: ${e instanceof Error ? e.message : String(e)}`
        );
      } finally {
        setDeletingId(null);
      }
    },
    [t]
  );

  const deleteLocalTrip = useCallback((tripId: string) => {
    removeLocalTripSnapshot(tripId);
    setRows((prev) =>
      prev
        .map((row) =>
          row.id === tripId
            ? {
                ...row,
                hasLocalSnapshot: false,
              }
            : row
        )
        .filter((row) => row.id !== tripId || row.canDeleteSole)
    );
  }, []);

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-zinc-500">
        {t("common.loading")}
      </main>
    );
  }

  if (needsSignIn && rows.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {t("trips.title")}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            {t("trips.signInHint")}
          </p>
          <button
            type="button"
            onClick={() => void startGoogleSignInForTrip(INDEX_AUTH_ID)}
            className="mt-6 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
          >
            {t("auth.continueWithGoogle")}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {t("trips.title")}
        </h1>
        <Link
          href="/new"
          className="rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
        >
          {t("trips.newTrip")}
        </Link>
      </div>

      {error ? (
        <p className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
          {t("common.error")}: {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("trips.none")}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {row.title || t("app.name")}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">{row.id}</div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {row.hasLocalSnapshot ? (
                    <button
                      type="button"
                      onClick={() => deleteLocalTrip(row.id)}
                      className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      Delete local
                    </button>
                  ) : null}
                  {row.canDeleteSole ? (
                    <button
                      type="button"
                      disabled={deletingId === row.id}
                      onClick={() => void deleteTrip(row.id)}
                      className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                    >
                      {deletingId === row.id ? t("trips.deleting") : t("trips.delete")}
                    </button>
                  ) : null}
                  <Link
                    href={`/trip/${row.id}`}
                    className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    {t("trips.open")}
                  </Link>
                </div>
              </div>
              {row.joinedAt ? (
                <div className="mt-2 text-xs text-zinc-500">
                  {t("trips.joinedAt")}: {row.joinedAt}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
