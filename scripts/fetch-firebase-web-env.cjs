/**
 * Fetches Firebase Web SDK config using the same service account JSON
 * used for Admin (Firebase Management API). The JSON file does NOT contain
 * apiKey/appId itself — this script calls Google's API to download them.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./trip-planner-xxx.json node scripts/fetch-firebase-web-env.cjs
 *
 * IAM: the service account needs permission to call Firebase Management
 * (e.g. "Firebase Admin" / "Viewer" on the project, or enable API and grant
 * firebase.management / firebase.readonly as needed).
 */

const fs = require("fs");
const path = require("path");
const { GoogleAuth } = require("google-auth-library");

const SCOPES = ["https://www.googleapis.com/auth/firebase.readonly"];

function loadServiceAccount() {
  const p =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!p?.trim()) {
    console.error(
      "Set FIREBASE_SERVICE_ACCOUNT_PATH (or GOOGLE_APPLICATION_CREDENTIALS) to your JSON file path."
    );
    process.exit(1);
  }
  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

async function main() {
  const sa = loadServiceAccount();
  const projectId = sa.project_id;
  if (!projectId) {
    console.error("service account JSON missing project_id");
    process.exit(1);
  }

  const auth = new GoogleAuth({
    credentials: sa,
    scopes: SCOPES,
  });
  const client = await auth.getClient();
  const base = "https://firebase.googleapis.com/v1beta1";

  const listUrl = `${base}/projects/${encodeURIComponent(projectId)}/webApps?pageSize=100`;
  let listRes;
  try {
    listRes = await client.request({ url: listUrl });
  } catch (e) {
    const err = /** @type {{ response?: { data?: unknown; status?: number } }} */ (e);
    console.error("Failed to list Web apps:", err.response?.data || e);
    console.error(
      "\nGrant this service account access to Firebase Management (Firebase console → IAM, or use a Firebase Admin / Editor role on the GCP project)."
    );
    process.exit(1);
  }

  const payload = listRes.data || {};
  const apps = payload.apps || payload.webApps || [];
  if (!Array.isArray(apps) || apps.length === 0) {
    console.error(
      `No Web apps are registered for project "${projectId}". The service account JSON does not include Web SDK keys.`
    );
    console.error(
      "Create a Web app: Firebase Console → Project settings → Your apps → Add app → Web, then run this script again (or copy the config snippet from the console)."
    );
    if (process.env.DEBUG_FIREBASE_LIST) {
      console.error("Raw list response:", JSON.stringify(payload, null, 2));
    }
    process.exit(1);
  }

  const first = apps[0];
  const appId = first.appId;
  if (!appId) {
    console.error("Unexpected list response (no appId):", JSON.stringify(first, null, 2));
    process.exit(1);
  }

  const configUrl = `${base}/projects/${encodeURIComponent(projectId)}/webApps/${encodeURIComponent(appId)}/config`;
  let cfgRes;
  try {
    cfgRes = await client.request({ url: configUrl });
  } catch (e) {
    const err = /** @type {{ response?: { data?: unknown } }} */ (e);
    console.error("Failed to get Web app config:", err.response?.data || e);
    process.exit(1);
  }

  const c = cfgRes.data;
  const lines = [
    "# Paste into .env.local (from Firebase Management API via your service account)",
    `NEXT_PUBLIC_FIREBASE_API_KEY=${c.apiKey || ""}`,
    `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${c.authDomain || ""}`,
    `NEXT_PUBLIC_FIREBASE_PROJECT_ID=${c.projectId || projectId}`,
    `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${c.storageBucket || ""}`,
    `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${c.messagingSenderId || ""}`,
    `NEXT_PUBLIC_FIREBASE_APP_ID=${c.appId || appId}`,
  ];
  if (c.measurementId) {
    lines.push(`# Optional Analytics: NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=${c.measurementId}`);
  }
  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
