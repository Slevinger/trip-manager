/**
 * One-off migration: normalize trip steps to discriminated union shape.
 *
 * Writes:
 * - step.type: "stay" | "transit"
 * - stay steps: hotels[]
 * - transit steps: transports[]
 *   (legacy step.transport string becomes one transport option title)
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./key.json npx tsx scripts/migrate-step-types-firestore.ts --all
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./key.json npx tsx scripts/migrate-step-types-firestore.ts --trip <tripId>
 */

import * as admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";
import {
  formatSpanBetweenStoredParts,
  splitStoredDateAndTime,
} from "../lib/timeline/dates";
import { applyTransitEndFromArrivals } from "../lib/timeline/hotelsAndDates";
import type {
  ArrivalOption,
  Hotel,
  StepStatus,
  TransportOption,
  TripStep,
} from "../lib/types/trip";
import { loadServiceAccount } from "../lib/firebase-admin";

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeHotels(raw: unknown): Hotel[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const h = toRecord(item);
    return {
      id: String(h.id ?? ""),
      name: String(h.name ?? ""),
      checkinDate: String(h.checkinDate ?? ""),
      checkinTime: String(h.checkinTime ?? ""),
      checkoutDate: String(h.checkoutDate ?? ""),
      checkoutTime: String(h.checkoutTime ?? ""),
      bookingUrl: String(h.bookingUrl ?? ""),
      cost: Number(h.cost ?? 0) || 0,
      notes: String(h.notes ?? ""),
    };
  });
}

function normalizeArrivalOptions(raw: unknown): ArrivalOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const r = toRecord(item);
    const st = splitStoredDateAndTime(r.startDate, r.startTime);
    const en = splitStoredDateAndTime(r.endDate, r.endTime);
    const computed = formatSpanBetweenStoredParts(st.date, st.time, en.date, en.time);
    const legacy = String(r.duration ?? "").trim();
    return {
      id: String(r.id ?? ""),
      title: String(r.title ?? ""),
      details: String(r.details ?? ""),
      duration: computed || legacy,
      cost: String(r.cost ?? ""),
      startDate: st.date,
      startTime: st.time,
      endDate: en.date,
      endTime: en.time,
    };
  });
}

function normalizeTransports(raw: unknown): TransportOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const t = toRecord(item);
    return {
      id: String(t.id ?? ""),
      title: String(t.title ?? ""),
      from: String(t.from ?? ""),
      to: String(t.to ?? ""),
      details: String(t.details ?? ""),
      duration: String(t.duration ?? ""),
      cost: String(t.cost ?? ""),
    };
  });
}

function normalizeStep(raw: unknown): TripStep {
  const s = toRecord(raw);
  const status: StepStatus =
    s.status === "todo" || s.status === "active" || s.status === "done"
      ? s.status
      : "todo";
  const coordinates =
    s.coordinates && typeof s.coordinates === "object"
      ? (s.coordinates as { lat: number; lng: number })
      : undefined;
  const mapX = typeof s.mapX === "number" ? s.mapX : undefined;
  const mapY = typeof s.mapY === "number" ? s.mapY : undefined;
  const base = {
    id: String(s.id ?? ""),
    order: Number(s.order ?? 0),
    title: String(s.title ?? ""),
    location: String(s.location ?? ""),
    status,
    startDate: String(s.startDate ?? ""),
    startTime: String(s.startTime ?? ""),
    endDate: String(s.endDate ?? ""),
    endTime: String(s.endTime ?? ""),
    endDateOpen: Boolean(s.endDateOpen ?? true),
    nights: Number(s.nights ?? 0),
    duration: String(s.duration ?? ""),
    arrivalSummary: String(s.arrivalSummary ?? ""),
    arrivalOptions: normalizeArrivalOptions(s.arrivalOptions),
    transportCost: Number(s.transportCost ?? 0),
    foodCost: Number(s.foodCost ?? 0),
    activitiesCost: Number(s.activitiesCost ?? 0),
    otherCost: Number(s.otherCost ?? 0),
    notes: String(s.notes ?? ""),
    attachments: Array.isArray(s.attachments) ? s.attachments : [],
    ...(coordinates ? { coordinates } : {}),
    ...(mapX !== undefined ? { mapX } : {}),
    ...(mapY !== undefined ? { mapY } : {}),
  };

  const hotels = normalizeHotels(s.hotels);
  const explicitType = s.type === "stay" || s.type === "transit" ? s.type : null;
  const inferredType = explicitType ?? (hotels.length > 0 ? "stay" : "transit");

  if (inferredType === "stay") {
    return { ...base, type: "stay", hotels };
  }

  const normalizedTransports = normalizeTransports(s.transports);
  const legacyTransport = String(s.transport ?? "").trim();
  const transports =
    normalizedTransports.length > 0
      ? normalizedTransports
      : legacyTransport
        ? [
            {
              id: uuidv4(),
              title: legacyTransport,
              from: "",
              to: "",
              details: "",
              duration: "",
              cost: "",
            },
          ]
        : [];
  const transit = {
    ...base,
    type: "transit" as const,
    transports,
    endDateOpen: false,
    nights: 0,
    transitEndManual: Boolean(s.transitEndManual),
  };
  return applyTransitEndFromArrivals(transit);
}

function parseArgs(): { mode: "all" | "single"; tripId?: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => a !== "--dry-run");
  if (positional[0] === "--all") return { mode: "all", dryRun };
  if (positional[0] === "--trip" && positional[1]?.trim()) {
    return { mode: "single", tripId: positional[1], dryRun };
  }
  console.error(
    "Usage:\n  npx tsx scripts/migrate-step-types-firestore.ts --all [--dry-run]\n  npx tsx scripts/migrate-step-types-firestore.ts --trip <tripId> [--dry-run]"
  );
  process.exit(1);
}

async function main() {
  const account = loadServiceAccount();
  if (!account) {
    console.error(
      "Missing service account: set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON"
    );
    process.exit(1);
  }
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(account) });
  }

  const { mode, tripId, dryRun } = parseArgs();
  const db = admin.firestore();

  const targets =
    mode === "single"
      ? [db.collection("trips").doc(tripId!)]
      : (await db.collection("trips").get()).docs.map((d) => d.ref);

  let changedDocs = 0;
  let totalSteps = 0;
  let wouldWriteDocs = 0;
  for (const ref of targets) {
    const snap = await ref.get();
    if (!snap.exists) continue;
    const raw = toRecord(snap.data());
    const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
    const normalized = stepsRaw.map(normalizeStep);
    totalSteps += normalized.length;
    const before = JSON.stringify(stepsRaw);
    const after = JSON.stringify(normalized);
    const changed = before !== after;
    if (!changed) continue;
    wouldWriteDocs += 1;
    if (!dryRun) {
      await ref.set(
        {
          steps: normalized,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      changedDocs += 1;
    }
  }

  if (dryRun) {
    console.log(
      `DRY RUN: would migrate ${wouldWriteDocs} trip docs (${totalSteps} steps scanned) in mode=${mode}${tripId ? ` tripId=${tripId}` : ""}`
    );
    return;
  }
  console.log(
    `OK: migrated ${changedDocs} trip docs (${totalSteps} steps scanned) in mode=${mode}${tripId ? ` tripId=${tripId}` : ""}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

