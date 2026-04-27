/**
 * Export one trip from Firestore as normalized JSON for local mocks / fixtures.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./key.json npx tsx scripts/export-trip-mock.ts <tripId> [outPath] [--anonymize]
 *
 * Default outPath: lib/mocks/mock-trip-from-firestore.json
 * Use --anonymize to replace owner fields before writing (safe to commit).
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import * as admin from "firebase-admin";
import type { Trip } from "../lib/types/trip";
import { loadServiceAccount } from "../lib/firebase-admin";
import { normalizeTripFromFirestore } from "../lib/trips";

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--anonymize");
  const anonymize = process.argv.includes("--anonymize");
  const tripId = args[0]?.trim();
  if (!tripId) {
    console.error(
      "Usage: FIREBASE_SERVICE_ACCOUNT_PATH=./key.json npx tsx scripts/export-trip-mock.ts <tripId> [outPath] [--anonymize]"
    );
    process.exit(1);
  }
  const outArg = args[1]?.trim();
  const outPath = outArg
    ? join(process.cwd(), outArg)
    : join(process.cwd(), "lib/mocks/mock-trip-from-firestore.json");

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

  const db = admin.firestore();
  const snap = await db.collection("trips").doc(tripId).get();
  if (!snap.exists) {
    console.error(`Trip not found: ${tripId}`);
    process.exit(1);
  }

  let trip: Trip = normalizeTripFromFirestore(
    tripId,
    snap.data() as Record<string, unknown>
  );
  if (anonymize) {
    trip = {
      ...trip,
      ownerUid: "mock-owner-uid",
      ownerEmail: "mock@example.com",
      ownerEmailLower: "mock@example.com",
      managePassword: "",
    };
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(trip, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath} (${trip.steps.length} steps)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
