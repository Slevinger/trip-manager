import { createHmac, timingSafeEqual } from "crypto";

const ALG = "sha256";

export type InviteTokenPayload = {
  tripId: string;
  emailLower: string;
  /** Unix seconds */
  exp: number;
};

export function signInviteToken(payload: InviteTokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac(ALG, secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyInviteToken(
  token: string,
  secret: string
): InviteTokenPayload | null {
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = createHmac(ALG, secret).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const json = Buffer.from(body, "base64url").toString("utf8");
    const p = JSON.parse(json) as InviteTokenPayload;
    if (
      typeof p.tripId !== "string" ||
      !p.tripId.trim() ||
      typeof p.emailLower !== "string" ||
      !p.emailLower.trim() ||
      typeof p.exp !== "number"
    ) {
      return null;
    }
    if (Math.floor(Date.now() / 1000) > p.exp) return null;
    return { tripId: p.tripId.trim(), emailLower: p.emailLower.trim().toLowerCase(), exp: p.exp };
  } catch {
    return null;
  }
}

export function inviteTokenSecret(): string | null {
  const s = process.env.INVITE_TOKEN_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

/** Public site URL for invite links (no trailing slash). */
export function appOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}
