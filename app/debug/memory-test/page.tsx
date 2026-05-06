"use client";

import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { subscribeMyCanonicalTrips } from "@/lib/canonicalTripsFirestore";
import { getClientAuth, getDb, getMissingFirebasePublicEnv } from "@/lib/firebase";
import type { Trip } from "@/lib/types/trip";
import { appendImmutableMemoryQueueTurn, subscribeImmutableMemoryQueueEntries } from "@/lib/usersFirestore";
import type { ImmutableMemoryQueueEntry } from "@/lib/types/user";

function pickTwoTripIds(trips: Trip[]): { a: string; b: string } {
  const a = trips[0]?.id ?? "";
  const b = trips[1]?.id ?? a ?? "";
  return { a, b };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDateDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${y}-${m}-${dd}`;
}

function dollars(n: number): string {
  return `$${n.toFixed(0)}`;
}

function mockUserLine(i: number): string {
  const cities = ["Berlin", "Rome", "Barcelona", "Tokyo", "Lisbon"];
  const city = cities[i % cities.length];
  const d0 = isoDateDaysFromNow(7 + i);
  const d1 = isoDateDaysFromNow(8 + i);
  const budget = dollars(120 + (i % 5) * 30);
  const themes = [
    `ב-${city} (${d0}) אני רוצה 2–3 רעיונות קצרים קרובים ברגל לשעות 18:00–21:00. =>`,
    `תמצא לי 1–2 אפשרויות אוכל מקומי ב-${city} עם דגש על טריות ובלי תור ארוך. תקציב בערך ${budget} לארוחה. =>`,
    `יש הופעה/קונצרט ב-${city} בין ${d0} ל-${d1}? עדיף ג'אז. =>`,
    `תבדוק מחירי כרטיסים/כניסה ואופציות הזמנה מראש ל-${city} בתאריך ${d0}. =>`,
    `אני שונא תורים ארוכים. תן לי חלופות ב-${city} עם הזמנה מראש או שעות פחות עמוסות. =>`,
  ];
  return `${themes[i % themes.length]} (mock ${i + 1})`;
}

function mockAssistantLine(i: number): string {
  const cities = ["Berlin", "Rome", "Barcelona", "Tokyo", "Lisbon"];
  const city = cities[i % cities.length];
  const d0 = isoDateDaysFromNow(7 + i);
  const prices = [12, 18, 25, 35, 49];
  const price = prices[i % prices.length];
  const urls = [
    "https://www.songkick.com/",
    "https://www.bandsintown.com/",
    "https://www.residentadvisor.net/",
    "https://www.berlin.de/en/events/",
    "https://www.timeout.com/",
  ];
  const url = urls[i % urls.length];

  const facts = [
    [
      `מצאתי דף אירועים רלוונטי ל-${city} סביב ${d0}.`,
      `מקור: ${url}`,
      `דגשים: כרטיסים לרוב בטווח ${dollars(price)}–${dollars(price + 30)} (תלוי אירוע) · מומלץ להזמין מראש בסופ\"ש.`,
    ],
    [
      `לג'אז/הופעות: בדוק/י “Listings” ב-${url} וסנן/י לפי ${city} ותאריכים ${d0}–${isoDateDaysFromNow(8 + i)}.`,
      `מחירי כניסה נפוצים: ${dollars(price)}–${dollars(price + 20)} · חלק מהמקומות מוכרים מראש בלבד.`,
      `אם תיתן/י שכונה או כתובת לינה, אוכל לצמצם לאופציות במרחק הליכה.`,
    ],
    [
      `אוכל מקומי ב-${city}: חפש/י מקום שמאפשר הזמנה מראש כדי להימנע מתורים.`,
      `טיפ פרקטי: יעד “fresh/seasonal” + טווח מחיר סביב ${dollars(price + 40)} לזוג.`,
      `מקור לרשימות/ביקורות: ${url}`,
    ],
    [
      `תור/עומס: נסה/י ללכת מוקדם (18:00) או מאוחר (אחרי 20:30).`,
      `אם יש אפשרות להזמנה מראש — זה שווה את זה במיוחד ב-${city} ב-${d0}.`,
      `רפרנס כללי: ${url}`,
    ],
  ];

  const block = facts[i % facts.length] ?? [];
  return `${block.join("\n")}\n\n(mock ${i + 1})`;
}

export default function MemoryTestPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripA, setTripA] = useState("");
  const [tripB, setTripB] = useState("");
  const [countPairs, setCountPairs] = useState(25);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

  const missingEnv = useMemo(() => getMissingFirebasePublicEnv(), []);
  const db = getDb();
  const useFirestore = Boolean(db && missingEnv.length === 0);

  const emailLower = (user?.email ?? "").trim().toLowerCase();

  const [queueInfo, setQueueInfo] = useState<{ loaded: boolean; active: number; total: number }>({
    loaded: false,
    active: 0,
    total: 0,
  });
  const [rows, setRows] = useState<ImmutableMemoryQueueEntry[]>([]);

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

  useEffect(() => {
    if (!useFirestore || !user || !db) return () => {};
    let unsub: (() => void) | undefined;
    unsub = subscribeMyCanonicalTrips(
      user,
      (list) => {
        setTrips(list);
        const { a, b } = pickTwoTripIds(list);
        setTripA((prev) => prev || a);
        setTripB((prev) => prev || b);
      },
      (e) => setStatus(e.message)
    );
    return () => unsub?.();
  }, [useFirestore, user, db]);

  useEffect(() => {
    if (!useFirestore || !emailLower) {
      setQueueInfo({ loaded: false, active: 0, total: 0 });
      setRows([]);
      return () => {};
    }
    return subscribeImmutableMemoryQueueEntries(
      emailLower,
      (rows) => {
        const active = rows.filter((r) => r.active).length;
        setQueueInfo({ loaded: true, active, total: rows.length });
        setRows(rows);
      },
      (e) => {
        setStatus(e.message);
        setQueueInfo({ loaded: true, active: 0, total: 0 });
        setRows([]);
      }
    );
  }, [useFirestore, emailLower]);

  const globalActive = useMemo(
    () => rows.filter((r) => r.tripId === "__global__" && r.active).slice(-10),
    [rows]
  );

  const globalLatestSummary = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.tripId === "__global__" && r.kind === "summary") return r;
    }
    return null;
  }, [rows]);

  async function triggerCompaction(): Promise<void> {
    const auth = getClientAuth();
    const token = await auth?.currentUser?.getIdToken();
    if (!token) throw new Error("Missing Firebase ID token (not signed in?)");
    const res = await fetch("/api/chat/immutable-memory-compact", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; active?: number };
    if (!res.ok) throw new Error(j.error || `Compaction failed (${res.status})`);
    setStatus(`Compaction ok. active=${j.active ?? "?"}`);
  }

  async function insertMock(): Promise<void> {
    if (!emailLower) throw new Error("Sign in first.");
    if (!tripA.trim() || !tripB.trim()) throw new Error("Pick two trips first.");
    const a = tripA.trim();
    const b = tripB.trim();

    setBusy(true);
    setStatus("Inserting mock turns…");
    try {
      const tripById = new Map(trips.map((tr) => [tr.id, tr] as const));
      for (let i = 0; i < countPairs; i++) {
        const tripId = i % 2 === 0 ? a : b;
        const userText = mockUserLine(i);
        const agentText = mockAssistantLine(i);
        const t = Date.now();

        const tr = tripById.get(tripId);
        const ctxNote = tr ? `${(tr.title ?? "Trip").trim()} · mock turn ${i + 1}` : `trip ${tripId} · mock`;

        await appendImmutableMemoryQueueTurn(emailLower, {
          tripId,
          userFromEmail: emailLower,
          userContent: userText,
          agentContent: agentText,
          sentAtMs: t,
        });

        // Mirror the chat dock: also append under `__global__`, with trip context attached.
        await appendImmutableMemoryQueueTurn(emailLower, {
          tripId: "__global__",
          userFromEmail: emailLower,
          userContent: userText,
          agentContent: agentText,
          sentAtMs: t + 2,
          tripContextNote: ctxNote,
          originTripId: tripId,
        });
      }
      setStatus("Inserted. Triggering compaction…");
      await triggerCompaction();
      setStatus("Done.");
    } finally {
      setBusy(false);
    }
  }

  if (process.env.NODE_ENV !== "development") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm">This page is dev-only.</p>
        <Link className="mt-4 inline-block text-sm text-violet-600" href="/">
          Back
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Memory Test (dev)</h1>
        <Link className="text-sm text-violet-600" href="/">
          Home
        </Link>
      </div>

      {!useFirestore ? (
        <p className="mt-4 text-sm text-red-700">
          Firestore is not configured. Missing: {missingEnv.join(", ") || "(unknown)"}
        </p>
      ) : null}

      {!authReady ? <p className="mt-4 text-sm">Auth loading…</p> : null}
      {authReady && !user ? (
        <p className="mt-4 text-sm text-red-700">Sign in with Google first (Home page).</p>
      ) : null}

      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-950">
        <p>
          <span className="font-semibold">User</span>: {emailLower || "(none)"}
        </p>
        <p>
          <span className="font-semibold">Immutable queue</span>:{" "}
          {queueInfo.loaded ? `${queueInfo.active} active / ${queueInfo.total} total` : "loading…"}
        </p>
      </div>

      <div className="mt-6 grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Trip A</span>
          <select
            value={tripA}
            onChange={(e) => setTripA(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            disabled={!trips.length}
          >
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} ({t.id})
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Trip B</span>
          <select
            value={tripB}
            onChange={(e) => setTripB(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            disabled={!trips.length}
          >
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} ({t.id})
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Mock pairs to insert</span>
          <input
            type="number"
            min={1}
            max={120}
            value={countPairs}
            onChange={(e) => setCountPairs(Number(e.target.value))}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="text-xs text-zinc-500">
            Each pair adds 2 immutable entries (user+assistant). Compaction triggers at 40 active.
          </span>
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void insertMock().catch((e) => setStatus(e instanceof Error ? e.message : String(e)))}
            disabled={!useFirestore || !user || busy}
            className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Insert mock + compact
          </button>
          <button
            type="button"
            onClick={() => void triggerCompaction().catch((e) => setStatus(e instanceof Error ? e.message : String(e)))}
            disabled={!useFirestore || !user || busy}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            Compact now
          </button>
        </div>

        {status ? <p className="text-sm text-zinc-700 dark:text-zinc-200">{status}</p> : null}
      </div>

      <div className="mt-6 grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Global memory (`__global__`)</p>
          <p className="text-xs text-zinc-500">
            {queueInfo.loaded ? `${globalActive.length} active shown` : "loading…"}
          </p>
        </div>

        {globalLatestSummary ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-700 dark:bg-zinc-900/40">
            <p className="font-semibold text-zinc-800 dark:text-zinc-200">
              Latest `__global__` summary (seq {globalLatestSummary.seq}, active{" "}
              {String(globalLatestSummary.active)}
              {typeof globalLatestSummary.evolveCount === "number"
                ? `, evolved ×${globalLatestSummary.evolveCount}`
                : ""}
              )
            </p>
            <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-200">
              {globalLatestSummary.content}
            </pre>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">No `__global__` summary yet.</p>
        )}

        <div className="grid gap-2">
          {globalActive.length === 0 ? (
            <p className="text-xs text-zinc-500">No active `__global__` entries yet.</p>
          ) : (
            globalActive.map((r) => (
              <div
                key={`${r.seq}:${r.role}:${r.createdAtMs}`}
                className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-700"
              >
                <p className="font-semibold text-zinc-800 dark:text-zinc-200">
                  seq {r.seq} · {r.role} · {r.kind} · active {String(r.active)}
                  {typeof r.evolveCount === "number" ? ` · evolved ×${r.evolveCount}` : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                  {r.content}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}

