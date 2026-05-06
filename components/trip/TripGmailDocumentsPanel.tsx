"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n/context";

type GmailStatus = { connected: boolean; googleEmail: string | null };

type GmailHit = {
  threadId: string;
  messageId: string;
  subject: string;
  snippet: string;
  internalDate: string;
  openInGmailUrl: string;
};

export function TripGmailDocumentsPanel({
  tripId,
  user,
  enabled,
}: {
  tripId: string;
  user: User | null;
  /** Cloud trips with Firestore + signed-in user. */
  enabled: boolean;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [extraQuery, setExtraQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<GmailHit[]>([]);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const authFetch = useCallback(
    async (input: RequestInfo, init?: RequestInit) => {
      if (!user) throw new Error("auth");
      const token = await user.getIdToken();
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      if (!headers.has("Content-Type") && init?.body != null) {
        headers.set("Content-Type", "application/json");
      }
      return fetch(input, { ...init, headers });
    },
    [user]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    let changed = false;
    if (sp.get("gmail_connected") === "1") {
      setBanner(t("trip.gmail.justConnected"));
      sp.delete("gmail_connected");
      changed = true;
    }
    const ge = sp.get("gmail_error");
    if (ge) {
      setError(ge);
      sp.delete("gmail_error");
      changed = true;
    }
    if (changed) {
      const qs = sp.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }
  }, [t]);

  useEffect(() => {
    if (!enabled || !user?.email?.trim()) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    setLoadingStatus(true);
    void authFetch("/api/integrations/gmail/status")
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as {
          connected?: boolean;
          googleEmail?: string | null;
          error?: string;
        } | null;
        if (!r.ok || !j) throw new Error(j?.error ?? "status_failed");
        if (!cancelled) {
          setStatus({
            connected: Boolean(j.connected),
            googleEmail: typeof j.googleEmail === "string" ? j.googleEmail : null,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setStatus({ connected: false, googleEmail: null });
      })
      .finally(() => {
        if (!cancelled) setLoadingStatus(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, user, authFetch]);

  async function connect() {
    setError(null);
    setBanner(null);
    try {
      const path =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "/";
      const r = await authFetch("/api/integrations/gmail/start", {
        method: "POST",
        body: JSON.stringify({ returnPath: path }),
      });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error ?? "start_failed");
      window.location.href = j.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function disconnect() {
    setError(null);
    setBanner(null);
    try {
      const r = await authFetch("/api/integrations/gmail/disconnect", {
        method: "POST",
        body: "{}",
      });
      if (!r.ok) throw new Error("disconnect_failed");
      setStatus({ connected: false, googleEmail: null });
      setHits([]);
      setLastQuery(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function search() {
    if (!status?.connected) return;
    setSearching(true);
    setError(null);
    setBanner(null);
    try {
      const r = await authFetch("/api/integrations/gmail/search", {
        method: "POST",
        body: JSON.stringify({
          tripId,
          query: extraQuery.trim() || undefined,
          maxResults: 20,
        }),
      });
      const j = (await r.json()) as {
        query?: string;
        messages?: GmailHit[];
        error?: string;
        detail?: string;
      };
      if (!r.ok) {
        const base = typeof j.error === "string" ? j.error : "search_failed";
        const detail = typeof j.detail === "string" ? `: ${j.detail}` : "";
        throw new Error(`${base}${detail}`);
      }
      setLastQuery(typeof j.query === "string" ? j.query : null);
      setHits(Array.isArray(j.messages) ? j.messages : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  if (!enabled || !user?.email?.trim()) return null;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
          {t("trip.gmail.title")}
        </h2>
        {status?.connected ? (
          <span className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            {t("trip.gmail.connected")}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{t("trip.gmail.intro")}</p>

      {banner ? (
        <p className="mt-2 rounded-lg bg-emerald-100 px-2 py-1.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100">
          {banner}
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 rounded-lg bg-red-100 px-2 py-1.5 text-xs font-medium text-red-900 whitespace-pre-wrap dark:bg-red-950/40 dark:text-red-100">
          {error === "gmail_oauth_not_configured"
            ? t("trip.gmail.oauthNotConfigured", {
                hint:
                  typeof window !== "undefined"
                    ? `${window.location.origin}/api/integrations/gmail/callback`
                    : "/api/integrations/gmail/callback",
              })
            : error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {loadingStatus ? (
          <span className="text-xs text-zinc-500">{t("common.loading")}</span>
        ) : status?.connected ? (
          <>
            {status.googleEmail ? (
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{status.googleEmail}</span>
            ) : null}
            <button
              type="button"
              onClick={() => void disconnect()}
              className="rounded-lg border border-zinc-300 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {t("trip.gmail.disconnect")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void connect()}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400"
          >
            {t("trip.gmail.connect")}
          </button>
        )}
      </div>

      {status?.connected ? (
        <div className="mt-4 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {t("trip.gmail.extraTerms")}
            <input
              type="text"
              value={extraQuery}
              onChange={(e) => setExtraQuery(e.target.value)}
              placeholder={t("trip.gmail.extraPlaceholder")}
              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </label>
          <button
            type="button"
            disabled={searching}
            onClick={() => void search()}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
          >
            {searching ? t("trip.gmail.searching") : t("trip.gmail.search")}
          </button>
          {lastQuery ? (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="font-semibold text-zinc-600 dark:text-zinc-300">
                {t("trip.gmail.queryLabel")}
              </span>{" "}
              <code className="break-all rounded bg-zinc-100 px-1 dark:bg-zinc-800">{lastQuery}</code>
            </p>
          ) : null}
          {hits.length === 0 && lastQuery && !searching ? (
            <p className="text-xs text-zinc-500">{t("trip.gmail.noResults")}</p>
          ) : null}
          <ul className="mt-2 space-y-2">
            {hits.map((h) => (
              <li
                key={`${h.threadId}-${h.messageId}`}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
              >
                <a
                  href={h.openInGmailUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-violet-700 hover:underline dark:text-violet-400"
                >
                  {h.subject}
                </a>
                {h.snippet ? (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">{h.snippet}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
