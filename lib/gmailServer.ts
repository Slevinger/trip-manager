import type { Firestore } from "firebase-admin/firestore";
import { OAuth2Client } from "google-auth-library";
import type { NextRequest } from "next/server";

import type { Trip } from "@/lib/types/trip";

/** Stored under users/{emailLower}/integrations/gmail (Admin SDK only). */
export const GMAIL_INTEGRATION_DOC_ID = "gmail";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const GMAIL_OAUTH_STATE_COLLECTION = "gmailOAuthStates";

export function normalizeUserEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

export function gmailOAuthRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/integrations/gmail/callback`;
}

export function resolveAppOrigin(req: NextRequest): string {
  const fixed = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fixed) return fixed.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto =
    (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0]?.trim() ?? "https";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}

export function createGmailOAuthClient(origin: string): OAuth2Client {
  const id = process.env.GMAIL_GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GMAIL_GOOGLE_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    throw new Error("GMAIL_GOOGLE_CLIENT_ID / GMAIL_GOOGLE_CLIENT_SECRET not configured");
  }
  return new OAuth2Client(id, secret, gmailOAuthRedirectUri(origin));
}

export function userGmailCredentialRef(db: Firestore, emailLower: string) {
  return db
    .collection("users")
    .doc(normalizeUserEmailKey(emailLower))
    .collection("integrations")
    .doc(GMAIL_INTEGRATION_DOC_ID);
}

/** Safe in-app path only (avoid open redirects after OAuth). */
export function sanitizeOAuthReturnPath(raw: string | undefined, fallback: string): string {
  const s = (raw ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//")) return fallback;
  if (s.length > 512) return fallback;
  return s;
}

function isoDateParts(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

function toGmailSlashDate(y: number, m: number, d: number): string {
  return `${y}/${m}/${d}`;
}

/** Gmail `after:` is inclusive of that calendar day (see Gmail search docs). */
export function gmailAfterFromIso(iso: string): string | null {
  const p = isoDateParts(iso);
  return p ? toGmailSlashDate(p.y, p.m, p.d) : null;
}

/** Exclusive upper bound: day after trip end. */
export function gmailBeforeExclusiveFromIso(iso: string): string | null {
  const p = isoDateParts(iso);
  if (!p) return null;
  const dt = new Date(p.y, p.m - 1, p.d);
  dt.setDate(dt.getDate() + 1);
  return toGmailSlashDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

function tokenizeForGmail(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u0590-\u05FF\u0400-\u04FF]+/iu)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && w.length <= 48);
}

function collectTripSearchTokens(trip: Trip): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (w: string) => {
    const k = w.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(w);
  };
  for (const w of tokenizeForGmail(trip.title)) push(w);
  for (const d of trip.destinations) {
    for (const w of tokenizeForGmail(d.title)) push(w);
    for (const w of tokenizeForGmail(d.location)) push(w);
    for (const w of tokenizeForGmail(d.description)) push(w);
  }
  return out;
}

const DEFAULT_KEYWORD_GROUP =
  "(flight OR booking OR reservation OR confirmation OR itinerary OR hotel OR ticket OR check-in)";

/**
 * Gmail search string from trip window + destination/title tokens (read-only search).
 * Caller may append extra terms from the user.
 */
export function gmailSearchQueryFromTrip(trip: Trip): string {
  const after = gmailAfterFromIso(trip.startDate);
  const before = gmailBeforeExclusiveFromIso(trip.endDate);
  const datePart =
    after && before ? `after:${after} before:${before}` : after ? `after:${after}` : "";
  const tokens = collectTripSearchTokens(trip);
  const keywordPart =
    tokens.length > 0 ? `(${tokens.slice(0, 8).join(" OR ")})` : DEFAULT_KEYWORD_GROUP;
  return [datePart, keywordPart].filter(Boolean).join(" ");
}

export type GmailMessageListItem = {
  threadId: string;
  messageId: string;
  subject: string;
  snippet: string;
  internalDate: string;
};

function headerSubject(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "(no subject)";
  const p = payload as { headers?: { name?: string; value?: string }[] };
  const headers = Array.isArray(p.headers) ? p.headers : [];
  const sub = headers.find((h) => (h.name ?? "").toLowerCase() === "subject");
  const v = typeof sub?.value === "string" ? sub.value.trim() : "";
  return v || "(no subject)";
}

export async function gmailSearchMessages(
  accessToken: string,
  q: string,
  maxResults: number
): Promise<GmailMessageListItem[]> {
  const cap = Math.max(1, Math.min(maxResults, 30));
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", q);
  listUrl.searchParams.set("maxResults", String(cap));

  const listRes = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    const errText = await listRes.text().catch(() => "");
    throw new Error(`gmail_list_failed:${listRes.status}:${errText.slice(0, 200)}`);
  }
  const listJson = (await listRes.json()) as { messages?: { id: string; threadId?: string }[] };
  const ids = listJson.messages ?? [];
  if (ids.length === 0) return [];

  const details = await Promise.all(
    ids.map(async ({ id }) => {
      const mu = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
      mu.searchParams.set("format", "metadata");
      mu.searchParams.append("metadataHeaders", "Subject");
      const mr = await fetch(mu.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!mr.ok) return null;
      const mj = (await mr.json()) as {
        threadId?: string;
        snippet?: string;
        internalDate?: string;
        payload?: unknown;
      };
      return {
        threadId: typeof mj.threadId === "string" ? mj.threadId : "",
        messageId: id,
        subject: headerSubject(mj.payload),
        snippet: typeof mj.snippet === "string" ? mj.snippet : "",
        internalDate: typeof mj.internalDate === "string" ? mj.internalDate : "",
      };
    })
  );

  return details.filter((x): x is GmailMessageListItem => x !== null && Boolean(x.threadId));
}

export function gmailInboxThreadLink(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId)}`;
}
