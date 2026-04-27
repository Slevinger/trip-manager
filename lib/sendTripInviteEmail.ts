import nodemailer from "nodemailer";

const RESEND_API = "https://api.resend.com/emails";
const ONBOARDING_FROM = "Trip Manager <onboarding@resend.dev>";

export type SendTripInviteEmailInput = {
  to: string;
  tripTitle: string;
  acceptPageUrl: string;
};

export type SendTripInviteEmailResult =
  | { ok: true }
  | { ok: false; error: string; resendMessage?: string };

function buildSubjectAndHtml(input: SendTripInviteEmailInput): {
  subject: string;
  html: string;
} {
  const subject = input.tripTitle.trim()
    ? `You’re invited: ${input.tripTitle.trim()}`
    : "You’re invited to a trip";

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #18181b;">
  <p>You’ve been invited to collaborate on a trip.</p>
  <p><strong>${escapeHtml(input.tripTitle.trim() || "Trip")}</strong></p>
  <p>Open the link below and click <strong>Accept invitation</strong> to join (use the same email on your Google account).</p>
  <p><a href="${escapeHtml(input.acceptPageUrl)}" style="display:inline-block;margin-top:12px;padding:10px 16px;background:#18181b;color:#fff;text-decoration:none;border-radius:10px;">Open invitation</a></p>
  <p style="font-size:12px;color:#71717a;">If the button doesn’t work, copy this URL:<br/>${escapeHtml(input.acceptPageUrl)}</p>
</body>
</html>`.trim();

  return { subject, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function smtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim()
  );
}

function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** SendGrid: free tier supports Single Sender Verification (personal Gmail) — no owned domain. */
function sendGridConfigured(): boolean {
  return Boolean(
    process.env.SENDGRID_API_KEY?.trim() && process.env.SENDGRID_FROM_EMAIL?.trim()
  );
}

/**
 * `auto` (default): SMTP → SendGrid → Resend.
 * `smtp` | `sendgrid` | `resend`: that transport only.
 */
function inviteTransportMode(): "auto" | "smtp" | "resend" | "sendgrid" {
  const v = process.env.INVITE_EMAIL_TRANSPORT?.trim().toLowerCase();
  if (v === "smtp") return "smtp";
  if (v === "resend") return "resend";
  if (v === "sendgrid") return "sendgrid";
  return "auto";
}

/** SendGrid v3 — success is HTTP 202 Accepted. */
async function sendViaSendGrid(input: SendTripInviteEmailInput): Promise<SendTripInviteEmailResult> {
  const key = process.env.SENDGRID_API_KEY!.trim();
  const fromEmail = process.env.SENDGRID_FROM_EMAIL!.trim();
  const fromName = process.env.SENDGRID_FROM_NAME?.trim() || "Trip Planner";
  const { subject, html } = buildSubjectAndHtml(input);

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.to.trim() }] }],
      from: { email: fromEmail, name: fromName },
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  });

  if (res.status === 202 || res.ok) {
    return { ok: true };
  }

  const text = await res.text().catch(() => "");
  let msg = text.slice(0, 400);
  try {
    const j = JSON.parse(text) as { errors?: { message?: string }[] };
    const first = j.errors?.[0]?.message;
    if (typeof first === "string" && first.trim()) msg = first.trim();
  } catch {
    /* keep slice */
  }
  return { ok: false, error: "sendgrid_failed", resendMessage: msg };
}

/**
 * Send via SMTP (Gmail, Outlook, Mailgun SMTP, etc.). No custom domain required for Gmail.
 *
 * Env:
 * - `SMTP_HOST` (e.g. smtp.gmail.com, or smtp-relay.brevo.com for Brevo’s free tier)
 * - `SMTP_PORT` (default 587)
 * - `SMTP_USER` / `SMTP_PASS` (Gmail: App Password with 2-Step Verification — no Workspace org needed for typical personal accounts; or Brevo SMTP login + key from their dashboard)
 * - `SMTP_FROM` optional (`you@gmail.com` or `Name <you@gmail.com>`); defaults to SMTP_USER
 * - `SMTP_SECURE=true` for port 465
 */
async function sendViaSmtp(input: SendTripInviteEmailInput): Promise<SendTripInviteEmailResult> {
  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT ?? "587") || 587;
  const user = process.env.SMTP_USER!.trim();
  const pass = process.env.SMTP_PASS!.trim();
  const secure =
    process.env.SMTP_SECURE === "1" ||
    process.env.SMTP_SECURE === "true" ||
    port === 465;

  const fromRaw = process.env.SMTP_FROM?.trim() || user;
  const from =
    fromRaw.includes("@") && !fromRaw.includes("<")
      ? `Trip Planner <${fromRaw}>`
      : fromRaw;

  const { subject, html } = buildSubjectAndHtml(input);

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to: input.to.trim(),
      subject,
      html,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: "smtp_failed", resendMessage: msg };
  }
}

/** `INVITE_FROM_EMAIL` as `you@domain.com` or `Name <you@domain.com>`. */
function formatFromAddress(raw: string): string {
  const t = raw.trim();
  if (!t) return ONBOARDING_FROM;
  if (/<[^>]+@[^>]+>/.test(t)) return t;
  if (t.includes("@") && !t.includes("<")) return `Trip Planner <${t}>`;
  return t;
}

function parseResendMessage(text: string): string {
  let msg = text.slice(0, 400);
  try {
    const j = JSON.parse(text) as { message?: string };
    if (typeof j.message === "string" && j.message.trim()) msg = j.message.trim();
  } catch {
    /* keep slice */
  }
  return msg;
}

function isLikelyUnverifiedDomainError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("not verified") ||
    m.includes("verify your domain") ||
    m.includes("resend.com/domains") ||
    (m.includes("domain") && m.includes("verify"))
  );
}

/** Resend test / onboarding sender: only the account owner inbox, not arbitrary invitees. */
function isResendTestRecipientOnlyError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("testing emails") ||
    m.includes("your own email address") ||
    (m.includes("only send") && m.includes("your") && m.includes("email"))
  );
}

async function postResend(
  key: string,
  from: string,
  input: SendTripInviteEmailInput
): Promise<{ ok: boolean; status: number; body: string }> {
  const { subject, html } = buildSubjectAndHtml(input);

  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to.trim()],
      subject,
      html,
    }),
  });

  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

async function sendViaResend(input: SendTripInviteEmailInput): Promise<SendTripInviteEmailResult> {
  const key = process.env.RESEND_API_KEY!.trim();
  const customRaw = process.env.INVITE_FROM_EMAIL?.trim();
  const primaryFrom = customRaw ? formatFromAddress(customRaw) : ONBOARDING_FROM;

  let r = await postResend(key, primaryFrom, input);
  if (r.ok) return { ok: true };

  let message = parseResendMessage(r.body);
  const allowFallback =
    process.env.NODE_ENV === "development" ||
    process.env.INVITE_RESEND_FALLBACK_ON_DOMAIN_ERROR === "1";

  if (
    allowFallback &&
    customRaw &&
    primaryFrom !== ONBOARDING_FROM &&
    isLikelyUnverifiedDomainError(message)
  ) {
    r = await postResend(key, ONBOARDING_FROM, input);
    if (r.ok) return { ok: true };
    message = parseResendMessage(r.body);
  }

  if (isResendTestRecipientOnlyError(message)) {
    return { ok: false, error: "resend_test_recipient_only", resendMessage: message };
  }

  return {
    ok: false,
    error: `resend_${r.status}`,
    resendMessage: message,
  };
}

/**
 * Sends the invite message.
 *
 * - **auto** (default): SMTP → SendGrid → Resend.
 * - **SendGrid** (`SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL`): free API mail; verify your Gmail under
 *   Sender Authentication → Single Sender Verification (no custom domain required to reach arbitrary invitees).
 * - **SMTP** (`SMTP_*`): Gmail, Brevo, etc.
 * - **Resend**: often needs a verified domain for arbitrary recipients.
 * - `INVITE_EMAIL_TRANSPORT`: `smtp` | `sendgrid` | `resend` to lock one provider.
 */
export async function sendTripInviteEmail(
  input: SendTripInviteEmailInput
): Promise<SendTripInviteEmailResult> {
  const mode = inviteTransportMode();
  if (mode === "smtp") {
    if (smtpConfigured()) return sendViaSmtp(input);
    return { ok: false, error: "missing_email_transport" };
  }
  if (mode === "sendgrid") {
    if (sendGridConfigured()) return sendViaSendGrid(input);
    return { ok: false, error: "missing_email_transport" };
  }
  if (mode === "resend") {
    if (resendConfigured()) return sendViaResend(input);
    return { ok: false, error: "missing_email_transport" };
  }
  if (smtpConfigured()) return sendViaSmtp(input);
  if (sendGridConfigured()) return sendViaSendGrid(input);
  if (resendConfigured()) return sendViaResend(input);
  return { ok: false, error: "missing_email_transport" };
}
