/**
 * Print the exact Firebase Auth UID for an email (for copying into participantUids).
 * Common mistake: typing lowercase L instead of uppercase I (e.g. ...vdls... vs ...vdIs...).
 *
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./trip-planner-494319-095b57d11f14.json \
 *     node scripts/verify-auth-uid.cjs annakatz36@gmail.com
 */

const fs = require("fs");
const path = require("path");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

function fatal(msg) {
  console.error(msg);
  process.exit(1);
}

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email) fatal("Usage: node scripts/verify-auth-uid.cjs <email>");

function loadCredential() {
  const inlineRaw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (inlineRaw) return JSON.parse(inlineRaw);
  const filePath = (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "").trim();
  if (!filePath)
    fatal("Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON.");
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

const app = getApps()[0] || initializeApp({ credential: cert(loadCredential()) });

(async () => {
  const u = await getAuth(app).getUserByEmail(email);
  console.log("\nEmail:", email);
  console.log("Exact UID (copy this):\n", u.uid);
  console.log("\nPer-character (detect I vs l vs |):\n");
  console.log([...u.uid].map((c, i) => `  [${i}] '${c}' U+${c.charCodeAt(0).toString(16)}`).join("\n"));
  console.log("");
})().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
