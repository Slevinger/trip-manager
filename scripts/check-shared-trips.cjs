/**
 * Diagnose why a user does not see trips they're a participant on.
 *
 * Usage:
 *   node scripts/check-shared-trips.cjs annakatz36@gmail.com
 *
 * Requires:
 *   FIREBASE_SERVICE_ACCOUNT_JSON in environment, OR pass a path to a key JSON file
 *   via FIREBASE_SERVICE_ACCOUNT_PATH. The repo root has
 *   `trip-planner-494319-095b57d11f14.json` which can be used.
 *
 * Examples:
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./trip-planner-494319-095b57d11f14.json \
 *     node scripts/check-shared-trips.cjs annakatz36@gmail.com
 *
 * What it does (Admin SDK, bypasses rules but DOES exercise the same indexes):
 *   1. Confirms the user exists in Firebase Auth and prints their UID + sign-in providers.
 *   2. Runs the exact `array-contains` query the client uses on `canonicalTrips`.
 *      Any "FAILED_PRECONDITION" / missing-index error surfaces here with the
 *      Firebase console URL to create the index.
 *   3. Falls back to a full scan of `canonicalTrips` and prints, for each doc,
 *      whether `participantEmailsLower` already contains the email — useful when
 *      the indexed query succeeds but returns 0 rows.
 *   4. Prints a summary listing the trips the user *should* see.
 */

const fs = require("fs");
const path = require("path");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldPath } = require("firebase-admin/firestore");

function fatal(msg) {
  console.error(msg);
  process.exit(1);
}

const argEmail = (process.argv[2] || "").trim().toLowerCase();
if (!argEmail) fatal("Email argument required. Usage: node scripts/check-shared-trips.cjs <email>");

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

const CANONICAL_TRIPS_COLLECTION = "canonicalTrips";
const PARTICIPANT_EMAILS_LOWER = "participantEmailsLower";

function fmtTrip(d) {
  const data = d.data() || {};
  return {
    id: d.id,
    title: typeof data.title === "string" ? data.title : "(untitled)",
    ownerUid: data.ownerUid ?? null,
    ownerEmailLower: data.ownerEmailLower ?? null,
    participantEmailsLower: Array.isArray(data.participantEmailsLower)
      ? data.participantEmailsLower
      : null,
    travelersWithEmail: Array.isArray(data.travelers)
      ? data.travelers
          .map((t) => (t && (t.email || t.Email)) || null)
          .filter(Boolean)
      : [],
    viewersWithEmail: Array.isArray(data.viewers)
      ? data.viewers.map((v) => (v && (v.email || v.Email)) || null).filter(Boolean)
      : [],
  };
}

(async () => {
  console.log(`\n=== Diagnose: trips visible to ${argEmail} ===\n`);

  // 1) Confirm the auth user exists.
  let userRecord = null;
  try {
    userRecord = await auth.getUserByEmail(argEmail);
  } catch (e) {
    console.warn(`[auth] No Firebase Auth user found for ${argEmail}: ${e.message || e}`);
  }
  if (userRecord) {
    const providers = (userRecord.providerData || []).map((p) => p.providerId).join(", ");
    console.log(`[auth] uid=${userRecord.uid} providers=${providers || "(none)"}\n`);
  }

  // 2) Run the same array-contains query the client uses.
  console.log(`[query] canonicalTrips where participantEmailsLower array-contains "${argEmail}"`);
  try {
    const snap = await db
      .collection(CANONICAL_TRIPS_COLLECTION)
      .where(PARTICIPANT_EMAILS_LOWER, "array-contains", argEmail)
      .get();
    console.log(`[query] -> ${snap.size} doc(s) returned by the indexed query.`);
    snap.forEach((d) => {
      const f = fmtTrip(d);
      console.log(
        `  - ${f.id} | "${f.title}" | owner=${f.ownerEmailLower ?? f.ownerUid} | ` +
          `participants=[${(f.participantEmailsLower || []).join(", ")}]`
      );
    });
    if (snap.size === 0) {
      console.log(
        "[query] 0 results means no canonicalTrips doc has this email in participantEmailsLower " +
          "— check whether trips are stored under a different collection or the field is missing."
      );
    }
  } catch (e) {
    console.error(`[query] FAILED: ${e.code || ""} ${e.message || e}`);
    if (String(e.message || "").toLowerCase().includes("requires an index")) {
      console.error(
        "[query] -> Missing Firestore index. Click the URL above (in the error message) " +
          "to create it, then re-run this script."
      );
    }
  }

  // 3) Full scan: catch stale `participantEmailsLower` or different storage.
  console.log(`\n[scan] Full scan of canonicalTrips for ${argEmail} on travelers/viewers/email fields...`);
  try {
    const all = await db.collection(CANONICAL_TRIPS_COLLECTION).get();
    let matched = 0;
    const stale = [];
    all.forEach((d) => {
      const f = fmtTrip(d);
      const onTravelers = f.travelersWithEmail
        .map((s) => String(s).toLowerCase())
        .includes(argEmail);
      const onViewers = f.viewersWithEmail
        .map((s) => String(s).toLowerCase())
        .includes(argEmail);
      const onParticipants = (f.participantEmailsLower || []).includes(argEmail);
      const ownerIsUser = userRecord && f.ownerUid === userRecord.uid;
      if (onTravelers || onViewers || onParticipants || ownerIsUser) {
        matched++;
        const flags = [
          ownerIsUser ? "owner" : null,
          onParticipants ? "participantEmailsLower" : null,
          onTravelers ? "travelers[]" : null,
          onViewers ? "viewers[]" : null,
        ]
          .filter(Boolean)
          .join(", ");
        console.log(`  - ${f.id} | "${f.title}" | matches via: ${flags}`);
        if (
          (onTravelers || onViewers) &&
          !onParticipants &&
          !ownerIsUser
        ) {
          stale.push({ id: f.id, title: f.title });
        }
      }
    });
    console.log(`[scan] Total ${all.size} canonicalTrips; ${matched} reference ${argEmail}.\n`);
    if (stale.length) {
      console.log(
        `[scan] STALE participantEmailsLower on ${stale.length} trip(s): the user is on travelers/viewers ` +
          `but missing from participantEmailsLower. Re-save (or run a backfill) to fix.`
      );
      for (const s of stale) console.log(`  - ${s.id} | "${s.title}"`);
    }
  } catch (e) {
    console.error(`[scan] FAILED: ${e.code || ""} ${e.message || e}`);
  }

  process.exit(0);
})().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});
