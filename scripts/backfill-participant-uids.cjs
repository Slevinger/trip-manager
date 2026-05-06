/**
 * Merge Firebase Auth UIDs into canonicalTrips.participantUids for every email in
 * participantEmailsLower (plus ownerUid). Fixes home-list queries that use
 * `participantUids array-contains` without waiting for each user to open the trip.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./trip-planner-494319-095b57d11f14.json \
 *     node scripts/backfill-participant-uids.cjs
 *
 * Safe to re-run: idempotent merge from current doc + Auth lookups.
 */

const fs = require("fs");
const path = require("path");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

function fatal(msg) {
  console.error(msg);
  process.exit(1);
}

function loadCredential() {
  const inlineRaw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (inlineRaw) {
    try {
      return JSON.parse(inlineRaw);
    } catch {
      fatal("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
  }
  const filePath = (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "").trim();
  if (filePath) {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (!fs.existsSync(abs)) fatal(`Service account file not found at ${abs}`);
    try {
      return JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch {
      fatal(`Service account file at ${abs} is not valid JSON.`);
    }
  }
  fatal(
    "Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH (e.g. " +
      "FIREBASE_SERVICE_ACCOUNT_PATH=./trip-planner-494319-095b57d11f14.json)."
  );
}

const cred = loadCredential();
const app = getApps()[0] || initializeApp({ credential: cert(cred) });
const auth = getAuth(app);
const db = getFirestore(app);

const COL = "canonicalTrips";

function sortedUniqueStrings(arr) {
  return Array.from(new Set(arr.filter((x) => typeof x === "string" && x.trim()))).sort();
}

(async () => {
  console.log(`\n[backfill] Scanning ${COL}…\n`);
  const snap = await db.collection(COL).get();
  let changed = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const ownerUid = typeof data.ownerUid === "string" ? data.ownerUid.trim() : "";
    const emails = Array.isArray(data.participantEmailsLower) ? data.participantEmailsLower : [];
    const existing = Array.isArray(data.participantUids) ? data.participantUids : [];

    const uidSet = new Set(sortedUniqueStrings([ownerUid, ...existing]));
    for (const em of emails) {
      if (typeof em !== "string" || !em.trim()) continue;
      try {
        const u = await auth.getUserByEmail(em.trim().toLowerCase());
        if (u?.uid) uidSet.add(u.uid);
      } catch {
        /* no Auth user for this email */
      }
    }

    const next = sortedUniqueStrings(Array.from(uidSet));
    const prev = sortedUniqueStrings([...existing]);
    if (next.length === prev.length && next.every((v, i) => v === prev[i])) {
      skipped++;
      continue;
    }
    await doc.ref.update({ participantUids: next });
    changed++;
    console.log(`  ${doc.id} | participantUids: ${prev.join(",") || "(none)"} → ${next.join(",")}`);
  }

  console.log(`\n[backfill] Done. Updated ${changed} doc(s), unchanged ${skipped}.\n`);
  process.exit(0);
})().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});
