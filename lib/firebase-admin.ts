import { existsSync, readFileSync } from "fs";
import { isAbsolute, join } from "path";
import * as admin from "firebase-admin";
import type { ServiceAccount } from "firebase-admin/app";

let cachedAccount: ServiceAccount | null | undefined;

function parseServiceAccountJson(raw: string): ServiceAccount | null {
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    return null;
  }
}

/** Loads service account JSON from env (server-only). */
export function loadServiceAccount(): ServiceAccount | null {
  if (cachedAccount !== undefined) {
    return cachedAccount;
  }

  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    const parsed = parseServiceAccountJson(inline);
    cachedAccount = parsed;
    return parsed;
  }

  const pathEnv =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (pathEnv) {
    const absolutePath = isAbsolute(pathEnv)
      ? pathEnv
      : join(/* turbopackIgnore: true */ process.cwd(), pathEnv);
    if (!existsSync(absolutePath)) {
      cachedAccount = null;
      return null;
    }
    const parsed = parseServiceAccountJson(
      readFileSync(absolutePath, "utf8")
    );
    cachedAccount = parsed;
    return parsed;
  }

  cachedAccount = null;
  return null;
}

export function isFirebaseAdminConfigured(): boolean {
  return loadServiceAccount() !== null;
}

export function getAdminAuth(): admin.auth.Auth {
  const account = loadServiceAccount();
  if (!account) {
    throw new Error("NO_ADMIN");
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(account),
    });
  }
  return admin.auth();
}
