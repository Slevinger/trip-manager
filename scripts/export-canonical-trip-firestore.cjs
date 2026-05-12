/**
 * Export a canonical trip (and related Firestore data) to JSON using the Admin SDK.
 *
 * The UUID you have is a *document id* under `canonicalTrips`, not a root collection name.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./your-service-account.json \
 *     node scripts/export-canonical-trip-firestore.cjs
 *
 *   node scripts/export-canonical-trip-firestore.cjs <tripDocumentId>
 *
 * Optional:
 *   --root-collection   Treat the id as a *top-level collection id* and export every doc (rare).
 *
 * Output: `exports/firestore-<tripId>.json` (created next to cwd, usually repo root).
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH (same as check-shared-trips.cjs).
 */

const fs = require("fs");
const path = require("path");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const CANONICAL_TRIPS = "canonicalTrips";
const LEGACY_TRIPS = "trips";
const ASSISTANT_THREAD = "assistantThread";

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

function serializeValue(v) {
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t !== "object") return v;
  if (Array.isArray(v)) return v.map(serializeValue);
  if (Buffer.isBuffer(v)) return { __firestore: "Bytes", base64: v.toString("base64") };
  if (typeof v.toMillis === "function") {
    try {
      return { __firestore: "Timestamp", iso: v.toDate().toISOString(), millis: v.toMillis() };
    } catch {
      /* fall through */
    }
  }
  if (typeof v._seconds === "number") {
    const ms = v._seconds * 1000 + (typeof v._nanoseconds === "number" ? v._nanoseconds / 1e6 : 0);
    return { __firestore: "Timestamp", iso: new Date(ms).toISOString() };
  }
  if (typeof v.latitude === "number" && typeof v.longitude === "number") {
    return { __firestore: "GeoPoint", lat: v.latitude, lng: v.longitude };
  }
  if (typeof v.path === "string" && typeof v.id === "string" && v.parent != null) {
    return { __firestore: "DocumentReference", path: v.path };
  }
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    out[k] = serializeValue(val);
  }
  return out;
}

async function exportSubcollections(docRef) {
  const cols = await docRef.listCollections();
  const out = {};
  for (const col of cols) {
    const snap = await col.get();
    out[col.id] = snap.docs.map((d) => ({
      id: d.id,
      path: d.ref.path,
      data: serializeValue(d.data()),
    }));
  }
  return out;
}

(async () => {
  const args = process.argv.slice(2).filter((a) => a !== "--root-collection");
  const rootCollectionMode = process.argv.includes("--root-collection");
  const tripId = (args[0] || "65708f1c-708f-487d-9fcf-2649870a4643").trim();
  if (!tripId) fatal("Missing trip / collection id.");

  const cred = loadCredential();
  const app = getApps()[0] || initializeApp({ credential: cert(cred) });
  const db = getFirestore(app);

  const exportsDir = path.join(process.cwd(), "exports");
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
  const outFile = path.join(exportsDir, `firestore-${tripId.replace(/[/\\]/g, "_")}.json`);

  if (rootCollectionMode) {
    const snap = await db.collection(tripId).get();
    const payload = {
      mode: "root-collection",
      collectionId: tripId,
      documentCount: snap.size,
      documents: snap.docs.map((d) => ({
        id: d.id,
        path: d.ref.path,
        data: serializeValue(d.data()),
      })),
    };
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8");
    console.log(`Wrote ${outFile} (${snap.size} documents).`);
    return;
  }

  const canonicalRef = db.collection(CANONICAL_TRIPS).doc(tripId);
  const canonicalSnap = await canonicalRef.get();

  if (!canonicalSnap.exists) {
    fatal(
      `No document at ${canonicalRef.path}. ` +
        `If you meant a top-level collection named "${tripId}", re-run with --root-collection.`
    );
  }

  const payload = {
    mode: "canonical-trip",
    exportedAt: new Date().toISOString(),
    canonicalTrip: {
      path: canonicalSnap.ref.path,
      id: canonicalSnap.id,
      data: serializeValue(canonicalSnap.data()),
      subcollections: await exportSubcollections(canonicalRef),
    },
  };

  const legacyThreadCol = db.collection(LEGACY_TRIPS).doc(tripId).collection(ASSISTANT_THREAD);
  try {
    const threadSnap = await legacyThreadCol.get();
    if (!threadSnap.empty) {
      payload.legacyTripsAssistantThread = {
        path: legacyThreadCol.path,
        documents: threadSnap.docs.map((d) => ({
          id: d.id,
          path: d.ref.path,
          data: serializeValue(d.data()),
        })),
      };
    }
  } catch (e) {
    payload.legacyTripsAssistantThreadNote = String(e?.message || e);
  }

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${outFile}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
