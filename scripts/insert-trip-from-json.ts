/**
 * Insert a trip document into Firestore from a JSON file (same shape as app / export script).
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./key.json npx tsx scripts/insert-trip-from-json.ts <path-to-trip.json> [--trip-id <uuid>] [--dry-run] [--force] [--no-members]
 *
 * - Trip id: `--trip-id` if set, else `id` from JSON (required one of them).
 * - Default: refuses if `trips/{id}` already exists (use `--force` to overwrite).
 * - Writes `trips/{id}` with server timestamps for createdAt/updatedAt.
 * - Unless `--no-members`, also writes `trips/{id}/members/{ownerUid}` when ownerUid + ownerEmailLower are set.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import * as admin from "firebase-admin";
import type { Trip } from "../lib/types/trip";
import { loadServiceAccount } from "../lib/firebase-admin";
import { normalizeTripFromFirestore } from "../lib/trips";

function parseArgs(): {
  jsonPath: string;
  tripId?: string;
  dryRun: boolean;
  force: boolean;
  noMembers: boolean;
} {
  const raw = process.argv.slice(2);
  let tripId: string | undefined;
  let jsonPath = "";
  let dryRun = false;
  let force = false;
  let noMembers = false;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--force") force = true;
    else if (a === "--no-members") noMembers = true;
    else if (a === "--trip-id" && raw[i + 1]) {
      tripId = raw[++i].trim();
    } else if (!a.startsWith("-")) {
      jsonPath = a;
    }
  }
  return { jsonPath, tripId, dryRun, force, noMembers };
}

function tripToFirestoreDoc(
  trip: Trip,
  timestamps: { createdAt: unknown; updatedAt: unknown }
): Record<string, unknown> {
  return {
    id: trip.id,
    title: trip.title,
    tripStartDate: trip.tripStartDate,
    tripStartTime: trip.tripStartTime,
    budget: trip.budget,
    managePassword: trip.managePassword,
    ownerUid: trip.ownerUid,
    ownerEmail: trip.ownerEmail,
    ownerEmailLower: trip.ownerEmailLower,
    accessMode: trip.accessMode,
    smartTimeline: trip.smartTimeline,
    autoCurrentByDate: trip.autoCurrentByDate,
    tripAttachments: trip.tripAttachments,
    steps: trip.steps,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  };
}

async function main() {
  const { jsonPath, tripId: tripIdFlag, dryRun, force, noMembers } = parseArgs();
  if (!jsonPath?.trim()) {
    console.error(
      "Usage: FIREBASE_SERVICE_ACCOUNT_PATH=./key.json npx tsx scripts/insert-trip-from-json.ts <path-to-trip.json> [--trip-id <uuid>] [--dry-run] [--force] [--no-members]"
    );
    process.exit(1);
  }

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

  const absolute = resolve(process.cwd(), jsonPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
  } catch (e) {
    console.error(`Cannot read or parse JSON: ${absolute}`, e);
    process.exit(1);
  }

  const raw = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
    string,
    unknown
  >;
  const idFromJson = typeof raw.id === "string" ? raw.id.trim() : "";
  const tripId = (tripIdFlag?.trim() || idFromJson).trim();
  if (!tripId) {
    console.error("Set `id` in the JSON or pass --trip-id <uuid>");
    process.exit(1);
  }

  const trip: Trip = normalizeTripFromFirestore(tripId, {
    ...raw,
    id: tripId,
  });

  const db = admin.firestore();
  const ref = db.collection("trips").doc(tripId);
  const existing = await ref.get();
  if (existing.exists && !force) {
    console.error(
      `Trip already exists: ${tripId}. Use --force to overwrite, or a different --trip-id.`
    );
    process.exit(1);
  }

  const ts = admin.firestore.FieldValue.serverTimestamp();
  const payload = tripToFirestoreDoc(trip, { createdAt: ts, updatedAt: ts });

  if (dryRun) {
    console.log("DRY RUN — would write trips/", tripId, {
      ...payload,
      createdAt: "[serverTimestamp]",
      updatedAt: "[serverTimestamp]",
    });
    return;
  }

  await ref.set(payload);
  console.log(`Wrote trips/${tripId}`);

  if (!noMembers && trip.ownerUid.trim() && trip.ownerEmailLower.trim()) {
    await ref.collection("members").doc(trip.ownerUid).set(
      {
        uid: trip.ownerUid,
        email: trip.ownerEmail || trip.ownerEmailLower,
        emailLower: trip.ownerEmailLower,
        role: "member",
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`Wrote trips/${tripId}/members/${trip.ownerUid}`);
  } else if (!noMembers) {
    console.warn(
      "Skipped members doc: set ownerUid + ownerEmailLower in JSON, or use --no-members intentionally."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
