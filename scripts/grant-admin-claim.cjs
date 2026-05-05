/**
 * Usage:
 *   node scripts/grant-admin-claim.cjs shir.levinger@gmail.com
 *
 * Requires:
 *   FIREBASE_SERVICE_ACCOUNT_JSON in environment (or load via .env.local by your shell).
 */
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

function fatal(msg) {
  console.error(msg);
  process.exit(1);
}

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email) fatal("Email argument required.");

const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
if (!raw) fatal("Missing FIREBASE_SERVICE_ACCOUNT_JSON in environment.");

let cred;
try {
  cred = JSON.parse(raw);
} catch (e) {
  fatal("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
}

const app = getApps()[0] || initializeApp({ credential: cert(cred) });
const auth = getAuth(app);

(async () => {
  const u = await auth.getUserByEmail(email);
  const prev = u.customClaims || {};
  const next = { ...prev, isAdmin: true };
  await auth.setCustomUserClaims(u.uid, next);
  console.log(`OK: set isAdmin=true for ${email} (uid=${u.uid}).`);
  console.log("Note: user must sign out/in to refresh token claims.");
})().catch((e) => {
  console.error(e?.message || String(e));
  process.exit(1);
});

