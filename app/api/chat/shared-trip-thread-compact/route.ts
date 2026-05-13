import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { completeTripAssistantAnthropic } from "@/lib/tripAssistantAnthropic";
import { capEvolveSummaryChars, TRIP_MEMORY_EVOLVE_SYSTEM } from "@/lib/tripMemoryEvolvePrompt";
import { assertMonthlyBudgetAllowsNewSpend, recordLlmUsageUsd } from "@/lib/llmMonthlyBudget";
import { canonicalTripDocReadableByUser } from "@/lib/canonicalTripsFirestore";
import { notifySharedTripThreadUpdated } from "@/lib/tripSharedThreadPusherServer";

/**
 * Compaction for the shared per-trip assistant thread (`trips/{tripId}/assistantThread`).
 * Mirrors the per-user immutable compaction: when active >= 40 entries, take the oldest
 * 20, summarize them with `TRIP_MEMORY_EVOLVE_SYSTEM`, insert one summary entry, and mark
 * the originals inactive (never deleted).
 *
 * Caller must be allowed to read the canonical trip (same logic as shared-thread append).
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

type Provider = "openai" | "anthropic";

function openaiKey(): string | undefined {
  return process.env.OPENAI_SA_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || undefined;
}
function openaiModel(): string {
  return process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini";
}
function anthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim();
}
function anthropicModel(): string {
  return process.env.ANTHROPIC_CHAT_MODEL?.trim() || "claude-haiku-4-5";
}
function resolveProvider(): Provider {
  const explicit = process.env.TRIP_ASSISTANT_PROVIDER?.trim().toLowerCase();
  if (explicit === "anthropic") return "anthropic";
  if (explicit === "openai") return "openai";
  const hasOpen = Boolean(openaiKey());
  const hasAnt = Boolean(anthropicKey());
  if (hasAnt && !hasOpen) return "anthropic";
  return "openai";
}

async function loadServiceAccountJson(): Promise<string | null> {
  const env = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (env) return env;
  if (process.env.NODE_ENV !== "development") return null;
  try {
    const p = join(process.cwd(), "trip-planner-494319-095b57d11f14.json");
    const raw = await readFile(p, "utf8");
    return raw.trim() || null;
  } catch {
    return null;
  }
}

async function ensureAdminApp(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (getApps().length) return { ok: true };
  const raw = await loadServiceAccountJson();
  if (!raw) return { ok: false, error: "Missing FIREBASE_SERVICE_ACCOUNT_JSON" };
  try {
    const cred = JSON.parse(raw) as ServiceAccount;
    initializeApp({ credential: cert(cred) });
    return { ok: true };
  } catch {
    return { ok: false, error: "Invalid FIREBASE_SERVICE_ACCOUNT_JSON" };
  }
}

function bearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/.exec(h.trim());
  return m?.[1]?.trim() || null;
}

type ThreadEntry = {
  id: string;
  role: "user" | "assistant";
  from: string;
  content: string;
  active: boolean;
  kind: "message" | "summary";
  createdAtMs: number;
  evolveCount: number;
  tripContext?: string;
};

function detectLanguageFromLatestUser(entries: ThreadEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.role !== "user") continue;
    const s = e.content ?? "";
    if (/[\u0590-\u05FF]/.test(s)) return "Hebrew";
    if (/[\u0600-\u06FF\u0750-\u077F]/.test(s)) return "Arabic";
    if (/[\u0400-\u04FF]/.test(s)) return "Russian";
    return "English";
  }
  return "English";
}

async function evolveTripThread(
  provider: Provider,
  entries: ThreadEntry[],
  nextEvolveCount: number
): Promise<
  | { ok: true; summary: string; usage?: { inputTokens: number; outputTokens: number } | { promptTokens: number; completionTokens: number } }
  | { ok: false; status: number; error: string; detail?: string }
> {
  const lang = detectLanguageFromLatestUser(entries);
  const system =
    TRIP_MEMORY_EVOLVE_SYSTEM +
    `\n\n### Evolve metadata\nThis summary will be evolution pass #${nextEvolveCount} for this trip's shared thread.` +
    `\n\n### Language override (server-detected)\nLatest user message appears to be in: ${lang}.\nWrite ALL section prose in ${lang}. Keep section headers exactly (LEGEND:, FROM_WEB_OR_VERIFIED:, CHAT_ONLY_MEMORY:, OPEN_LOOSE_ENDS:). URLs and proper nouns must remain unchanged.`;

  const userBlock = entries
    .map((m) => {
      const speaker = m.role === "assistant" ? "Assistant" : `User<${m.from}>`;
      return `${speaker}: ${m.content.trim()}`;
    })
    .join("\n\n")
    .slice(0, 200_000);

  if (provider === "anthropic") {
    const key = anthropicKey();
    if (!key) return { ok: false, status: 503, error: "Missing ANTHROPIC_API_KEY" };
    const r = await completeTripAssistantAnthropic({
      apiKey: key,
      model: anthropicModel(),
      system,
      turns: [{ role: "user", content: userBlock }],
      maxOutputTokens: 4096,
      temperature: 0.35,
    });
    if (!r.ok) return { ok: false, status: r.status, error: "Anthropic evolve failed", detail: r.body };
    return { ok: true, summary: capEvolveSummaryChars(r.text), usage: r.usage };
  }

  const key = openaiKey();
  if (!key) return { ok: false, status: 503, error: "Missing OPENAI_API_KEY" };

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: openaiModel(),
      messages: [
        { role: "system", content: system },
        { role: "user", content: userBlock },
      ],
      temperature: 0.35,
      max_completion_tokens: 4096,
    }),
  });

  const raw = await res.text();
  if (!res.ok) return { ok: false, status: res.status, error: `OpenAI returned HTTP ${res.status}.`, detail: raw };

  let parsed: {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return { ok: false, status: 502, error: "Invalid OpenAI response" };
  }
  const text = capEvolveSummaryChars(parsed.choices?.[0]?.message?.content?.trim() ?? "");
  const usage = parsed.usage;
  return {
    ok: true,
    summary: text,
    ...(usage
      ? {
          usage: {
            promptTokens: Number(usage.prompt_tokens) || 0,
            completionTokens: Number(usage.completion_tokens) || 0,
          },
        }
      : {}),
  };
}

export async function POST(req: NextRequest) {
  const init = await ensureAdminApp();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });

  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization bearer token" }, { status: 401 });

  let body: { tripId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const tripId = typeof body.tripId === "string" ? body.tripId.trim() : "";
  if (!tripId) return NextResponse.json({ error: "Missing tripId" }, { status: 400 });

  const auth = getAuth();
  let uid = "";
  try {
    const decoded = await auth.verifyIdToken(token);
    uid = (decoded.uid ?? "").toString();
    if (!uid) return NextResponse.json({ error: "Token missing uid" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
  }

  const db = getFirestore();
  const tripRef = db.collection("trips").doc(tripId);
  // NOTE: trip auth metadata (`ownerUid`, `participantEmailsLower`) lives on
  // `canonicalTrips/{tripId}`, not `trips/{tripId}`. Read from there.
  const canonicalSnap = await db.collection("canonicalTrips").doc(tripId).get();
  if (!canonicalSnap.exists) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const tripData = canonicalSnap.data() as Record<string, unknown>;
  let callerEmail = "";
  try {
    const u = await auth.getUser(uid);
    callerEmail = (u.email ?? "").toString().trim().toLowerCase();
  } catch {
    callerEmail = "";
  }
  if (!canonicalTripDocReadableByUser(uid, callerEmail, tripData)) {
    return NextResponse.json({ error: "Caller is not a participant of this trip" }, { status: 403 });
  }

  const budgetGate = await assertMonthlyBudgetAllowsNewSpend();
  if (!budgetGate.ok) return NextResponse.json({ error: budgetGate.message }, { status: 429 });

  const col = tripRef.collection("assistantThread");
  const scanSnap = await col.orderBy("createdAtMs", "asc").limit(1000).get();

  const all: ThreadEntry[] = [];
  for (const d of scanSnap.docs) {
    const raw = d.data() as Record<string, unknown>;
    const role = raw.role === "user" || raw.role === "assistant" ? (raw.role as "user" | "assistant") : null;
    const from = typeof raw.from === "string" ? raw.from : "";
    const content = typeof raw.content === "string" ? raw.content : "";
    const active = raw.active === true;
    const kind = raw.kind === "message" || raw.kind === "summary" ? (raw.kind as "message" | "summary") : null;
    const createdAtMs =
      typeof raw.createdAtMs === "number" && Number.isFinite(raw.createdAtMs) ? raw.createdAtMs : NaN;
    const evolveCount =
      typeof raw.evolveCount === "number" && Number.isFinite(raw.evolveCount)
        ? Math.max(0, Math.floor(raw.evolveCount))
        : 0;
    const tripContext = typeof raw.tripContext === "string" ? raw.tripContext : undefined;
    if (!role || !from || !kind || !Number.isFinite(createdAtMs)) continue;
    all.push({ id: d.id, role, from, content, active, kind, createdAtMs, evolveCount, ...(tripContext ? { tripContext } : {}) });
  }

  const active = all.filter((e) => e.active);
  if (active.length < 40) {
    return NextResponse.json({ ok: true, compacted: false, active: active.length });
  }

  const oldest = active.slice(0, 20);
  const provider = resolveProvider();
  const priorMax = oldest.reduce((m, e) => Math.max(m, e.evolveCount || 0), 0);
  const nextEvolveCount = priorMax + 1;

  const r = await evolveTripThread(provider, oldest, nextEvolveCount);
  if (!r.ok) {
    return NextResponse.json(
      { error: r.error, detail: r.detail?.slice(0, 600), status: r.status },
      { status: r.status >= 400 && r.status < 600 ? r.status : 502 }
    );
  }

  if (r.usage && "inputTokens" in r.usage) {
    try {
      await recordLlmUsageUsd({
        provider: "anthropic",
        model: anthropicModel(),
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
      });
    } catch {}
  } else if (r.usage && "promptTokens" in r.usage) {
    try {
      await recordLlmUsageUsd({
        provider: "openai",
        model: openaiModel(),
        inputTokens: r.usage.promptTokens,
        outputTokens: r.usage.completionTokens,
      });
    } catch {}
  }

  const now = Date.now();
  const summaryDoc = col.doc();
  const batch = db.batch();
  batch.set(summaryDoc, {
    tripId,
    role: "assistant",
    from: "agent",
    content: r.summary.slice(0, 8000),
    kind: "summary",
    active: true,
    createdAtMs: now,
    memoryCompressed: true,
    evolveCount: nextEvolveCount,
  });
  for (const e of oldest) {
    batch.set(col.doc(e.id), { active: false, compactedAtMs: now }, { merge: true });
  }
  batch.set(tripRef, { lastAssistantThreadCompactionAtMs: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();

  void notifySharedTripThreadUpdated(tripId).catch(() => {});

  return NextResponse.json({
    ok: true,
    compacted: true,
    compactedCount: oldest.length,
    summaries: 1,
    nextEvolveCount,
  });
}
