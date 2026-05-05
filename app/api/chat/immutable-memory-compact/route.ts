import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { completeTripAssistantAnthropic } from "@/lib/tripAssistantAnthropic";
import { capEvolveSummaryChars, TRIP_MEMORY_EVOLVE_SYSTEM } from "@/lib/tripMemoryEvolvePrompt";
import {
  USER_PROFILE_MEMORY_EVOLVE_DURABLE_OVERRIDE,
  USER_PROFILE_MEMORY_EVOLVE_SYSTEM,
} from "@/lib/userProfileMemoryPrompt";
import { assertMonthlyBudgetAllowsNewSpend, recordLlmUsageUsd } from "@/lib/llmMonthlyBudget";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

type TripAssistantProvider = "openai" | "anthropic";

function openaiKey(): string | undefined {
  return (
    process.env.OPENAI_SA_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    undefined
  );
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

function resolveTripAssistantProvider(): TripAssistantProvider {
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
  // Dev-only convenience: allow running the compaction test locally without setting env,
  // by reading the service account JSON file that already exists in this repo.
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

type QueueEntry = {
  id: string;
  seq: number;
  tripId: string;
  role: "user" | "assistant";
  content: string;
  active: boolean;
  kind: "message" | "summary";
  evolveCount: number;
};

function detectLanguageFromLatestUser(entries: QueueEntry[]): string {
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

function turnsForEvolve(entries: QueueEntry[]): { role: "user" | "assistant"; content: string }[] {
  return entries.map((e) => ({ role: e.role, content: e.content }));
}

async function evolveSummaryForTripEntries(
  provider: TripAssistantProvider,
  tripEntries: QueueEntry[],
  nextEvolveCount: number
): Promise<{
  ok: true;
  summary: string;
  usage?: { inputTokens: number; outputTokens: number } | { promptTokens: number; completionTokens: number };
} | { ok: false; status: number; error: string; detail?: string }> {
  const lang = detectLanguageFromLatestUser(tripEntries);
  const isGlobal = tripEntries.length > 0 && tripEntries[0]?.tripId === "__global__";
  const baseSystem = isGlobal ? USER_PROFILE_MEMORY_EVOLVE_SYSTEM : TRIP_MEMORY_EVOLVE_SYSTEM;
  const headerConstraint = isGlobal
    ? "Keep the section headers exactly as shown (LEGEND:, FAVORITES:, DISLIKES:, PREFERENCES:, IMPORTANT_FACTS:, OPEN_TOPICS:)."
    : "Keep the section headers exactly as shown (LEGEND:, FROM_WEB_OR_VERIFIED:, CHAT_ONLY_MEMORY:, OPEN_LOOSE_ENDS:).";
  const durableOverride =
    isGlobal && nextEvolveCount >= 2 ? USER_PROFILE_MEMORY_EVOLVE_DURABLE_OVERRIDE : "";
  const system =
    baseSystem +
    `\n\n### Evolve metadata\nThis summary will be evolution pass #${nextEvolveCount} for this scope.` +
    (durableOverride ? `\n${durableOverride}` : "") +
    `\n\n### Language override (server-detected)\nLatest user message appears to be in: ${lang}.\nWrite ALL section prose in ${lang}.\n${headerConstraint} URLs and proper nouns must remain unchanged.`;

  const userBlock = turnsForEvolve(tripEntries)
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content.trim()}`)
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
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
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
    ...(usage ? { usage: { promptTokens: Number(usage.prompt_tokens) || 0, completionTokens: Number(usage.completion_tokens) || 0 } } : {}),
  };
}

/**
 * Compacts the immutable queue for the signed-in user:
 * - when active entries >= 40
 * - take oldest 20 active entries (by seq)
 * - group by tripId, summarize each group, insert summary entries
 * - mark those 20 original entries inactive (never delete)
 */
export async function POST(req: NextRequest) {
  const init = await ensureAdminApp();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });

  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization bearer token" }, { status: 401 });

  const auth = getAuth();
  let emailLower = "";
  try {
    const decoded = await auth.verifyIdToken(token);
    const email = (decoded.email ?? "").toString().trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Token missing email" }, { status: 401 });
    emailLower = email;
  } catch {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
  }

  const budgetGate = await assertMonthlyBudgetAllowsNewSpend();
  if (!budgetGate.ok) {
    return NextResponse.json({ error: budgetGate.message }, { status: 429 });
  }

  const db = getFirestore();
  const userRef = db.collection("users").doc(emailLower);
  const col = userRef.collection("immutableMemoryQueueEntries");

  // Avoid composite index requirements by querying `orderBy(seq)` only (single-field index),
  // then filtering `active` in memory.
  const scanSnap = await col.orderBy("seq", "asc").limit(500).get();
  const scanned: QueueEntry[] = [];
  for (const d of scanSnap.docs) {
    const raw = d.data() as Record<string, unknown>;
    const seq = typeof raw.seq === "number" ? raw.seq : NaN;
    const tripId = typeof raw.tripId === "string" ? raw.tripId : "";
    const role = raw.role === "user" || raw.role === "assistant" ? raw.role : null;
    const content = typeof raw.content === "string" ? raw.content : "";
    const active = raw.active === true;
    const kind = raw.kind === "message" || raw.kind === "summary" ? raw.kind : null;
    const evolveCount =
      typeof raw.evolveCount === "number" && Number.isFinite(raw.evolveCount)
        ? Math.max(0, Math.floor(raw.evolveCount))
        : 0;
    if (!Number.isFinite(seq) || !tripId || !role || !kind) continue;
    scanned.push({ id: d.id, seq, tripId, role, content, active, kind, evolveCount });
  }

  const activeEntries = scanned.filter((e) => e.active);
  if (activeEntries.length < 40) {
    return NextResponse.json({ ok: true, compacted: false, active: activeEntries.length });
  }

  const oldest = activeEntries.slice(0, 20);
  if (oldest.length === 0) {
    return NextResponse.json({ ok: true, compacted: false, active: activeEntries.length });
  }

  // Group by tripId (plan requirement).
  const byTrip = new Map<string, QueueEntry[]>();
  for (const e of oldest) {
    const arr = byTrip.get(e.tripId) ?? [];
    arr.push(e);
    byTrip.set(e.tripId, arr);
  }

  const provider = resolveTripAssistantProvider();

  const summaries: {
    tripId: string;
    summary: string;
    evolveCount: number;
    usage?: { inTok: number; outTok: number };
  }[] = [];
  for (const [tripId, entries] of byTrip.entries()) {
    // Evolution count for this group = max prior evolveCount among inputs + 1.
    // Plain message inputs count as 0; folding a summary bumps the counter.
    const priorMax = entries.reduce((m, e) => Math.max(m, e.evolveCount || 0), 0);
    const nextEvolveCount = priorMax + 1;

    const r = await evolveSummaryForTripEntries(provider, entries, nextEvolveCount);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, detail: r.detail?.slice(0, 600), status: r.status },
        { status: r.status >= 400 && r.status < 600 ? r.status : 502 }
      );
    }

    if (provider === "anthropic" && r.usage && "inputTokens" in r.usage) {
      try {
        await recordLlmUsageUsd({
          provider: "anthropic",
          model: anthropicModel(),
          inputTokens: r.usage.inputTokens,
          outputTokens: r.usage.outputTokens,
        });
      } catch {}
      summaries.push({
        tripId,
        summary: r.summary,
        evolveCount: nextEvolveCount,
        usage: { inTok: r.usage.inputTokens, outTok: r.usage.outputTokens },
      });
    } else if (provider === "openai" && r.usage && "promptTokens" in r.usage) {
      try {
        await recordLlmUsageUsd({
          provider: "openai",
          model: openaiModel(),
          inputTokens: r.usage.promptTokens,
          outputTokens: r.usage.completionTokens,
        });
      } catch {}
      summaries.push({
        tripId,
        summary: r.summary,
        evolveCount: nextEvolveCount,
        usage: { inTok: r.usage.promptTokens, outTok: r.usage.completionTokens },
      });
    } else {
      summaries.push({ tripId, summary: r.summary, evolveCount: nextEvolveCount });
    }
  }

  // Allocate seq for summaries, mark originals inactive.
  const nowMs = Date.now();
  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const data = (userSnap.data() as Record<string, unknown> | undefined) ?? {};
    const prevSeqRaw = data.immutableQueueSeq;
    let seq =
      typeof prevSeqRaw === "number" && Number.isFinite(prevSeqRaw) ? Math.max(0, Math.floor(prevSeqRaw)) : 0;

    for (const s of summaries) {
      seq += 1;
      const docRef = col.doc(); // new summary entry
      tx.set(docRef, {
        seq,
        tripId: s.tripId,
        role: "assistant",
        from: "agent",
        content: s.summary.slice(0, 8000),
        kind: "summary",
        active: true,
        memoryCompressed: true,
        evolveCount: s.evolveCount,
        createdAtMs: nowMs,
      });
    }

    for (const e of oldest) {
      tx.set(
        col.doc(e.id),
        { active: false, compactedAtMs: nowMs },
        { merge: true }
      );
    }

    tx.set(userRef, { immutableQueueSeq: seq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  return NextResponse.json({ ok: true, compacted: true, compactedCount: oldest.length, summaries: summaries.length });
}

