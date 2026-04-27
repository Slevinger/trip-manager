/**
 * Creates a **new** trip in Firestore from the mock JSON template, owned by a real Firebase user.
 * That user is also written as `trips/{id}/members/{uid}` so they can open the trip in the app.
 *
 * Default member / owner: shir.levinger@gmail.com (must exist in Firebase Auth).
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./key.json npx tsx scripts/seed-mock-trip.ts
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./key.json npx tsx scripts/seed-mock-trip.ts ./path/to-trip.json
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./key.json npx tsx scripts/seed-mock-trip.ts --email other@example.com
 *   ... [--dry-run]
 */

import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as admin from "firebase-admin";
import type { Trip } from "../lib/types/trip";
import { getAdminAuth } from "../lib/firebase-admin";
import { normalizeTripFromFirestore } from "../lib/trips";

const DEFAULT_EMAIL = "shir.levinger@gmail.com";
const DEFAULT_JSON = "lib/mocks/mock-trip-from-firestore.json";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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

function parseArgs(): { jsonPath: string; email: string; dryRun: boolean } {
  const raw = process.argv.slice(2);
  let email = DEFAULT_EMAIL;
  let jsonPath = DEFAULT_JSON;
  let dryRun = false;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--email" && raw[i + 1]) {
      email = raw[++i].trim();
    } else if (!a.startsWith("-")) {
      jsonPath = a;
    }
  }
  return { jsonPath, email, dryRun };
}

async function main() {
  const { jsonPath, email, dryRun } = parseArgs();
  const emailLower = normalizeEmail(email);
  if (!emailLower) {
    console.error("Invalid --email");
    process.exit(1);
  }

  const auth = getAdminAuth();
  let user: admin.auth.UserRecord;
  try {
    user = await auth.getUserByEmail(emailLower);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    console.error(
      `No Firebase Auth user for ${emailLower}.` +
        (code === "auth/user-not-found"
          ? " Create the account (e.g. sign in once with Google) then run again."
          : ` (${String(code ?? e)})`)
    );
    process.exit(1);
  }

  const ownerEmail = (user.email ?? email).trim();
  const ownerLower = normalizeEmail(ownerEmail);

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

  const newTripId = randomUUID();
  let trip: Trip = normalizeTripFromFirestore(newTripId, {
    ...raw,
    id: newTripId,
  });

  const baseTitle = String(trip.title ?? "").trim() || "Trip";
  trip = {
    ...trip,
    ownerUid: user.uid,
    ownerEmail,
    ownerEmailLower: ownerLower,
    title: `${baseTitle} (mock)`,
    accessMode: "invited_only",
  };

  const db = admin.firestore();
  const ts = admin.firestore.FieldValue.serverTimestamp();
  const payload = tripToFirestoreDoc(trip, { createdAt: ts, updatedAt: ts });

  if (dryRun) {
    console.log("DRY RUN — would create:", {
      tripId: newTripId,
      title: trip.title,
      memberEmail: ownerLower,
      memberUid: user.uid,
      steps: trip.steps.length,
    });
    return;
  }

  const ref = db.collection("trips").doc(newTripId);
  await ref.set(payload);
  await ref.collection("members").doc(user.uid).set(
    {
      uid: user.uid,
      email: ownerEmail,
      emailLower: ownerLower,
      role: "member",
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`Created trip ${newTripId}`);
  console.log(`  title: ${trip.title}`);
  console.log(`  member: ${ownerLower} (${user.uid})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
