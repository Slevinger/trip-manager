import { NextRequest, NextResponse } from "next/server";
import { requireFirebaseUser } from "@/lib/adminAuth";
import { FX_RATES_DAILY_COLLECTION } from "@/lib/fx/fxRatesConstants";
import { frankfurterUsdRatesForDate } from "@/lib/fx/frankfurterUsdFetch";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

function parseTargets(param: string | null): string[] {
  if (!param?.trim()) return [];
  return [...new Set(param.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].filter((c) => c !== "USD");
}

function validDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/**
 * GET `/api/fx/rates?date=YYYY-MM-DD&targets=ILS,EUR`
 *
 * Reads `fxRatesDaily/{date}` (USD-base `rates` map). Fetches Frankfurter for any missing target
 * currencies, merges into Firestore, then returns the subset needed for the client.
 */
export async function GET(req: NextRequest) {
  const auth = await requireFirebaseUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server Firestore not configured" }, { status: 503 });

  const url = new URL(req.url);
  const date = (url.searchParams.get("date") || new Date().toISOString().slice(0, 10)).trim();
  if (!validDate(date)) return NextResponse.json({ error: "Invalid date (use YYYY-MM-DD)" }, { status: 400 });

  const targets = parseTargets(url.searchParams.get("targets"));
  if (targets.length === 0) {
    return NextResponse.json({
      requestedDate: date,
      effectiveDate: date,
      base: "USD",
      rates: {} as Record<string, number>,
    });
  }

  const ref = db.collection(FX_RATES_DAILY_COLLECTION).doc(date);
  const snap = await ref.get();
  const prev = snap.data() as
    | {
        rates?: Record<string, number>;
        effectiveDate?: string;
        base?: string;
      }
    | undefined;

  const merged: Record<string, number> = {};
  for (const [k, v] of Object.entries(prev?.rates ?? {})) {
    const kk = k.trim().toUpperCase();
    if (typeof v === "number" && Number.isFinite(v) && v > 0) merged[kk] = v;
  }

  const missing = targets.filter((c) => !(c in merged));
  let effectiveDate = (typeof prev?.effectiveDate === "string" && prev.effectiveDate.trim()
    ? prev.effectiveDate.trim()
    : date) as string;

  if (missing.length > 0) {
    const fetched = await frankfurterUsdRatesForDate(date, missing);
    if (!fetched) {
      return NextResponse.json({ error: "Could not load rates from exchange provider" }, { status: 502 });
    }
    effectiveDate = fetched.date;
    for (const [k, v] of Object.entries(fetched.rates)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) merged[k.toUpperCase()] = v;
    }

    const currencies = Object.keys(merged).sort();
    await ref.set(
      {
        date,
        base: "USD",
        rates: merged,
        effectiveDate,
        updatedAt: new Date().toISOString(),
        currencies,
      },
      { merge: true }
    );
  }

  const out: Record<string, number> = {};
  for (const c of targets) {
    const v = merged[c];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[c] = v;
  }
  const stillMissing = targets.filter((c) => out[c] == null);
  if (stillMissing.length > 0) {
    return NextResponse.json(
      { error: `Missing FX for: ${stillMissing.join(", ")} (requested date ${date})` },
      { status: 502 }
    );
  }

  return NextResponse.json({
    requestedDate: date,
    effectiveDate,
    base: "USD",
    rates: out,
  });
}
