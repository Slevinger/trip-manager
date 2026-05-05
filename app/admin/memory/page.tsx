"use client";

import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getClientAuth, getDb, getMissingFirebasePublicEnv } from "@/lib/firebase";

type AdminUserRow = { id: string; emailLower: string; email: string };
type ImmutableRow = {
  id: string;
  seq?: number;
  tripId?: string;
  role?: string;
  from?: string;
  kind?: string;
  active?: boolean;
  content?: string;
  evolveCount?: number;
  memoryCompressed?: boolean;
  tripContext?: string;
  originTripId?: string;
  requestKind?: "general" | "specific";
};
type TripChatDoc = { tripId: string; messages?: unknown[]; updatedAt?: unknown };

async function fetchJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...(init ?? {}),
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j as T;
}

export default function AdminMemoryPage() {
  const missingEnv = useMemo(() => getMissingFirebasePublicEnv(), []);
  const db = getDb();
  const useFirestore = Boolean(db && missingEnv.length === 0);

  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string>("");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [immutable, setImmutable] = useState<ImmutableRow[]>([]);
  const [tripChats, setTripChats] = useState<TripChatDoc[]>([]);

  const [immFilterTripId, setImmFilterTripId] = useState("");
  const [immShowActiveOnly, setImmShowActiveOnly] = useState(true);
  const [immKind, setImmKind] = useState<"" | "message" | "summary">("");
  const [immSearch, setImmSearch] = useState("");

  const [editingImmId, setEditingImmId] = useState<string>("");
  const [editingImmContent, setEditingImmContent] = useState<string>("");
  const [checkedImm, setCheckedImm] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const auth = getClientAuth();
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setToken("");
        setUsers([]);
        return;
      }
      const t = await u.getIdToken(true);
      setToken(t);
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const r = await fetchJson<{ users: AdminUserRow[] }>("/api/admin/users", token);
        setUsers(r.users);
        setSelected((prev) => prev || r.users[0]?.emailLower || "");
        setStatus("");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [token]);

  function buildImmutableUrl(emailLower: string, tripId: string): string {
    const base = `/api/admin/user/${encodeURIComponent(emailLower)}/immutable`;
    const tid = tripId.trim();
    return tid ? `${base}?tripId=${encodeURIComponent(tid)}` : base;
  }

  useEffect(() => {
    if (!token || !selected) return;
    void (async () => {
      try {
        const r1 = await fetchJson<{ entries: ImmutableRow[] }>(
          buildImmutableUrl(selected, immFilterTripId),
          token
        );
        const r2 = await fetchJson<{ chats: TripChatDoc[] }>(
          `/api/admin/user/${encodeURIComponent(selected)}/trip-chat`,
          token
        );
        setImmutable(r1.entries ?? []);
        setTripChats(r2.chats ?? []);
        setStatus("");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [token, selected, immFilterTripId]);

  async function refreshSelected(): Promise<void> {
    if (!token || !selected) return;
    const r1 = await fetchJson<{ entries: ImmutableRow[] }>(
      buildImmutableUrl(selected, immFilterTripId),
      token
    );
    const r2 = await fetchJson<{ chats: TripChatDoc[] }>(
      `/api/admin/user/${encodeURIComponent(selected)}/trip-chat`,
      token
    );
    setImmutable(r1.entries ?? []);
    setTripChats(r2.chats ?? []);
  }

  async function deleteImmutable(id: string) {
    if (!token || !selected) return;
    if (!confirm("Delete this immutable entry? This cannot be undone.")) return;
    setBusy(true);
    setStatus("");
    try {
      await fetchJson(
        `/api/admin/user/${encodeURIComponent(selected)}/immutable`,
        token,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        }
      );
      await refreshSelected();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteCheckedImmutable() {
    if (!token || !selected) return;
    const ids = Object.entries(checkedImm)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} immutable entries? This cannot be undone.`)) return;
    setBusy(true);
    setStatus("");
    try {
      for (const id of ids) {
        await fetchJson(
          `/api/admin/user/${encodeURIComponent(selected)}/immutable`,
          token,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          }
        );
      }
      setCheckedImm({});
      await refreshSelected();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveImmutableEdit() {
    if (!token || !selected || !editingImmId) return;
    setBusy(true);
    setStatus("");
    try {
      await fetchJson(
        `/api/admin/user/${encodeURIComponent(selected)}/immutable`,
        token,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingImmId, patch: { content: editingImmContent } }),
        }
      );
      setEditingImmId("");
      setEditingImmContent("");
      await refreshSelected();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTripChat(tripId: string) {
    if (!token || !selected) return;
    if (!confirm(`Delete tripAssistantChats/${tripId}? This removes the per-trip UI chat only.`)) return;
    setBusy(true);
    setStatus("");
    try {
      await fetchJson(
        `/api/admin/user/${encodeURIComponent(selected)}/trip-chat`,
        token,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tripId }),
        }
      );
      await refreshSelected();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const filteredImmutable = useMemo(() => {
    const tripId = immFilterTripId.trim();
    const q = immSearch.trim().toLowerCase();
    return immutable
      .filter((r) => (immShowActiveOnly ? r.active === true : true))
      .filter((r) => (immKind ? r.kind === immKind : true))
      .filter((r) => (tripId ? (r.tripId ?? "") === tripId : true))
      .filter((r) => (q ? (r.content ?? "").toLowerCase().includes(q) : true))
      .sort((a, b) => (Number(a.seq ?? 0) || 0) - (Number(b.seq ?? 0) || 0));
  }, [immutable, immShowActiveOnly, immKind, immFilterTripId, immSearch]);

  const filteredImmutableIds = useMemo(() => filteredImmutable.map((r) => r.id), [filteredImmutable]);
  const checkedCount = useMemo(
    () => Object.values(checkedImm).filter(Boolean).length,
    [checkedImm]
  );

  if (process.env.NODE_ENV !== "development") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm">Admin dashboard is intended for controlled environments.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10" dir="ltr">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Admin memory</h1>
        <Link className="text-sm text-violet-600" href="/">
          Home
        </Link>
      </div>

      {!useFirestore ? (
        <p className="mt-3 text-sm text-red-700">
          Firestore is not configured. Missing: {missingEnv.join(", ") || "(unknown)"}
        </p>
      ) : null}

      {status ? <p className="mt-3 text-sm text-red-700">{status}</p> : null}

      <div className="mt-6 grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">User</span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            disabled={!users.length}
          >
            {users.map((u) => (
              <option key={u.emailLower} value={u.emailLower}>
                {u.email} ({u.emailLower})
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-zinc-500">
          Requires custom claim <code>isAdmin=true</code>. Use <code>npm run admin:grant shir.levinger@gmail.com</code> then sign out/in.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold">Immutable memory (includes __global__)</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {immutable.length} rows loaded · showing {filteredImmutable.length}
          </p>

          <div className="mt-3 grid gap-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid min-w-0 gap-1 text-xs">
                <span className="font-semibold">tripId filter</span>
                <input
                  value={immFilterTripId}
                  onChange={(e) => setImmFilterTripId(e.target.value)}
                  placeholder="__global__ or trip id"
                  className="min-w-0 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                />
                <div className="flex min-w-0 flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setImmFilterTripId("__global__")}
                    className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                    title="Filter to global memory"
                  >
                    __global__
                  </button>
                  <button
                    type="button"
                    onClick={() => setImmFilterTripId("")}
                    className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                    title="Clear filter"
                  >
                    clear
                  </button>
                </div>
              </label>
              <label className="grid min-w-0 gap-1 text-xs">
                <span className="font-semibold">kind</span>
                <select
                  value={immKind}
                  onChange={(e) => setImmKind(e.target.value as any)}
                  className="min-w-0 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="">all</option>
                  <option value="message">message</option>
                  <option value="summary">summary</option>
                </select>
              </label>
              <label className="grid min-w-0 gap-1 text-xs">
                <span className="font-semibold">search content</span>
                <input
                  value={immSearch}
                  onChange={(e) => setImmSearch(e.target.value)}
                  placeholder="contains…"
                  className="min-w-0 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900/40">
                <input
                  type="checkbox"
                  checked={immShowActiveOnly}
                  onChange={(e) => setImmShowActiveOnly(e.target.checked)}
                />
                <span className="font-semibold">active only</span>
              </label>
            </div>

            {editingImmId ? (
              <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold">Editing immutable entry: {editingImmId}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditingImmId("");
                        setEditingImmContent("");
                      }}
                      className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs font-semibold text-zinc-800 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveImmutableEdit()}
                      className="rounded-lg bg-violet-600 px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      Save
                    </button>
                  </div>
                </div>
                <textarea
                  value={editingImmContent}
                  onChange={(e) => setEditingImmContent(e.target.value)}
                  rows={8}
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-900/40">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={
                      filteredImmutableIds.length > 0 &&
                      filteredImmutableIds.every((id) => checkedImm[id] === true)
                    }
                    onChange={(e) => {
                      const on = e.target.checked;
                      setCheckedImm((prev) => {
                        const next = { ...prev };
                        for (const id of filteredImmutableIds) next[id] = on;
                        return next;
                      });
                    }}
                  />
                  <span className="font-semibold">Select all (filtered)</span>
                </label>
                <span className="text-zinc-500">{checkedCount} selected</span>
              </div>
              <button
                type="button"
                disabled={busy || checkedCount === 0}
                onClick={() => void deleteCheckedImmutable()}
                className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-800 disabled:opacity-40 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
              >
                Delete checked
              </button>
            </div>
          </div>

          <div className="mt-3 max-h-[60vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filteredImmutable.slice(-200).map((r) => (
                <div key={r.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <label className="mt-0.5 shrink-0">
                        <input
                          type="checkbox"
                          checked={checkedImm[r.id] === true}
                          onChange={(e) =>
                            setCheckedImm((prev) => ({ ...prev, [r.id]: e.target.checked }))
                          }
                        />
                      </label>
                      <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        seq {String(r.seq ?? "")} · tripId {r.tripId} · {r.kind} · {r.role} · active{" "}
                        {String(r.active)}
                        {typeof r.evolveCount === "number" ? ` · evolved ×${r.evolveCount}` : ""}
                        {r.originTripId && r.originTripId !== r.tripId ? ` · origin ${r.originTripId}` : ""}
                        {r.requestKind ? ` · ${r.requestKind}` : ""}
                      </p>
                      {r.tripContext ? (
                        <p className="mt-1 truncate text-[11px] italic text-zinc-500">
                          [trip-context] {r.tripContext}
                        </p>
                      ) : null}
                      <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                        {(r.content ?? "").slice(0, 8000)}
                      </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditingImmId(r.id);
                          setEditingImmContent(r.content ?? "");
                        }}
                        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs font-semibold text-zinc-800 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteImmutable(r.id)}
                        className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-800 disabled:opacity-40 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredImmutable.length === 0 ? (
                <p className="p-3 text-xs text-zinc-500">No rows match filters.</p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold">Trip chats (tripAssistantChats)</h2>
          <p className="mt-1 text-xs text-zinc-500">{tripChats.length} trip docs loaded</p>
          <div className="mt-3 max-h-[60vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {tripChats.map((c) => (
                <div key={c.tripId} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {c.tripId} · messages {Array.isArray(c.messages) ? c.messages.length : 0}
                      </p>
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-[11px] leading-relaxed dark:border-zinc-700 dark:bg-zinc-900/40">
                        {JSON.stringify(c.messages ?? [], null, 2)}
                      </pre>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteTripChat(c.tripId)}
                        className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-800 disabled:opacity-40 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {tripChats.length === 0 ? <p className="p-3 text-xs text-zinc-500">No chats.</p> : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

