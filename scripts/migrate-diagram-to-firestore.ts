/**
 * One-off migration: diagram JSON array → Firestore `trips/{tripId}.steps`
 *
 * Mapping rules live in `lib/diagramImport.ts` (diagramJsonToTripSteps).
 *
 * Usage (from repo root, with service account env set):
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./your-key.json npx tsx scripts/migrate-diagram-to-firestore.ts <tripId> <path-to-diagram-array.json>
 *
 * Example:
 *   npm run migrate:diagram -- 8cfdbd98-8f5c-44da-8be8-3d995bebdb8d ./data/thailand-steps.json
 *
 * Requires an existing trip document (open the trip in the app once) or only `steps` will be written merged.
 */

import { existsSync, readFileSync } from "fs";
import { isAbsolute, resolve } from "path";
import * as admin from "firebase-admin";
import { diagramJsonToTripSteps } from "../lib/diagramImport";
import { loadServiceAccount } from "../lib/firebase-admin";

async function main() {
  const tripId = process.argv[2];
  const jsonPath = process.argv[3];
  if (!tripId?.trim() || !jsonPath?.trim()) {
    console.error(
      "Usage: FIREBASE_SERVICE_ACCOUNT_PATH=./key.json npx tsx scripts/migrate-diagram-to-firestore.ts <tripId> <diagram-array.json>"
    );
    process.exit(1);
  }

  const abs = isAbsolute(jsonPath) ? jsonPath : resolve(process.cwd(), jsonPath);
  if (!existsSync(abs)) {
    console.error(`File not found:\n  ${abs}`);
    console.error(`Current directory:\n  ${process.cwd()}`);
    console.error(
      "Create a JSON file containing only the diagram steps array, or pass a full path, e.g.:\n  npm run migrate:diagram -- <tripId> /Users/you/Downloads/thailand-diagram.json"
    );
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(abs, "utf8")) as unknown;
  const steps = diagramJsonToTripSteps(raw);

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
  const ref = db.collection("trips").doc(tripId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(
      `Document trips/${tripId} does not exist. Open https://localhost:3000/trip/${tripId} once in the app to create it, then run again.`
    );
    process.exit(1);
  }

  await ref.set(
    {
      steps,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`OK: wrote ${steps.length} steps to trips/${tripId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
