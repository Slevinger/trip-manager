import { NextRequest, NextResponse } from "next/server";
import { logCaughtExceptionServer } from "@/lib/logCaughtExceptionServer";
import {
  buildTripAssistantSystemPrompt,
  TRIP_ASSISTANT_WEB_REFINE_APPENDIX,
} from "@/lib/tripAssistantPrompt";
import { extractTripSuggestionsFromReply } from "@/lib/tripAssistantSuggestionSchema";
import {
  parseTripAssistantRequestKind,
  stripTripAssistantRequestKindMarker,
  TRIP_ASSISTANT_CLASSIFIED_SUGGESTIONS_APPENDIX,
  EXPAND_OPTIONS_RETRY_APPENDIX,
  type TripAssistantRequestKind,
} from "@/lib/tripAssistantRequestKind";
import { completeTripAssistantAnthropic } from "@/lib/tripAssistantAnthropic";
import {
  SCHEDULE_CHECK_APPENDIX,
  extractScheduleFixFromReply,
} from "@/lib/tripScheduleCheck";
import {
  normalizeTripAssistantTurnsForWebTool,
  replaceLastUserContent,
  replaceLastUserStripTrailingHashWeb,
  stripTrailingHashWebMarker,
  stripTripWebSearchMarkers,
  tripExplicitWebSyntaxRequested,
  tripUserMessageEndsWithHashWeb,
  tripUserMessageInlineHashWeb,
  tripUserMessageRequestsWebSearch,
} from "@/lib/tripAssistantWebIntent";
import type { Trip, TripRecommendation, UserPreferences } from "@/lib/types/trip";
import { formatAssistantReplyForMarkdown } from "@/lib/formatAssistantReplyMarkdown";
import { assertMonthlyBudgetAllowsNewSpend, recordLlmUsageUsd } from "@/lib/llmMonthlyBudget";
import { TRIP_ASSISTANT_OPENAI_MESSAGE_HISTORY_CAP } from "@/lib/tripChatEvolveGate";
import {
  buildTravelerLocationContextAppendix,
  parseViewerDevicePing,
} from "@/lib/tripTravelerLocationContext";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// ---------------------------------------------------------------------------
// Global venue image cache (Firestore — shared across all users and trips)
// ---------------------------------------------------------------------------

const VENUE_IMAGE_CACHE_COLLECTION = "venueImageCache";

function venueCacheKey(label: string): string {
  return label.trim().toLowerCase();
}

async function getCachedVenueImage(label: string): Promise<string | null> {
  const db = getAdminFirestore();
  if (!db) return null;
  try {
    const snap = await db
      .collection(VENUE_IMAGE_CACHE_COLLECTION)
      .doc(venueCacheKey(label))
      .get();
    const data = snap.data();
    return typeof data?.imageUrl === "string" ? data.imageUrl : null;
  } catch {
    return null;
  }
}

async function setCachedVenueImage(
  label: string,
  imageUrl: string,
  source: string
): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;
  try {
    await db
      .collection(VENUE_IMAGE_CACHE_COLLECTION)
      .doc(venueCacheKey(label))
      .set({ imageUrl, source, cachedAt: new Date() }, { merge: true });
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// Server-side OG image enrichment
// ---------------------------------------------------------------------------

const OG_FETCH_TIMEOUT_MS = 9_000;
const OG_READ_LIMIT_BYTES = 200_000;

/** Hosts that block server-side scraping (403/redirect). Images must come via og-fetcher or LLM. */
const BOOKING_PLATFORM_HOSTS_SET = new Set([
  "booking.com", "airbnb.com", "airbnb.co.il", "vrbo.com",
  "hotels.com", "agoda.com", "viator.com", "getyourguide.com", "expedia.com",
  "tripadvisor.com", "tripadvisor.co.il", "tripadvisor.co.uk",
]);

function extractOgImageUrl(html: string, base: URL): string | null {
  const props = ["og:image", "og:image:url", "twitter:image", "twitter:image:src"];
  for (const p of props) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, "i");
    const m = re1.exec(html) ?? re2.exec(html);
    if (m?.[1]) {
      try { return new URL(m[1], base.toString()).toString(); } catch { return m[1]; }
    }
  }
  return null;
}

async function fetchOgImageUrl(pageUrl: string): Promise<string | null> {
  let target: URL;
  try { target = new URL(pageUrl); } catch { return null; }

  if (isBookingPlatformUrl(pageUrl)) return null;

  try {
    const res = await fetch(target.toString(), {
      signal: AbortSignal.timeout(OG_FETCH_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      cache: "no-store",
    });
    if (!res.ok) {
      console.log(`[og-fetch] ${pageUrl} → HTTP ${res.status}`);
      return null;
    }
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
      if (total >= OG_READ_LIMIT_BYTES) break;
    }
    reader.cancel().catch(() => {});
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    const found = extractOgImageUrl(new TextDecoder().decode(merged), target);
    console.log(`[og-fetch] ${pageUrl} → ${found ?? "no og:image found"}`);
    return found;
  } catch (err) {
    console.log(`[og-fetch] ${pageUrl} → error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function isBookingPlatformUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return BOOKING_PLATFORM_HOSTS_SET.has(h) || BOOKING_PLATFORM_HOSTS_SET.has(h.split(".").slice(-2).join("."));
  } catch {
    return false;
  }
}



/** Searches Wikipedia for `name` and returns the article's og:image if found. */
async function fetchWikipediaOgImage(name: string): Promise<string | null> {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(name)}&limit=1&format=json`;
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(4_000) });
    if (!searchRes.ok) return null;
    const [, titles] = await searchRes.json() as [string, string[]];
    const title = titles?.[0];
    if (!title) return null;
    const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    return await fetchOgImageUrl(pageUrl);
  } catch {
    return null;
  }
}

/** Returns true when the URL resolves to a real image (non-OTA, 2xx, image content-type). */
async function verifyImageUrl(url: string): Promise<boolean> {
  if (!url || isBookingPlatformUrl(url)) return false;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(4_000),
      redirect: "follow",
    });
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") ?? "";
    return ct.startsWith("image/");
  } catch {
    return false;
  }
}

/**
 * Simple semaphore — limits how many image-lookup coroutines run at the same time.
 * Prevents bursting N parallel Anthropic web-search calls when suggestions arrive.
 */
function makeSemaphore(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (active < limit) { active++; resolve(); }
      else queue.push(resolve);
    });
  const release = () => {
    active--;
    if (queue.length > 0) { active++; queue.shift()!(); }
  };
  return { acquire, release };
}

/** One semaphore shared across a single enrichment pass — max 2 concurrent LLM image lookups. */
const IMAGE_LLM_CONCURRENCY = 2;

interface ResolvedOptionData { imageUrl: string; priceNote?: string }

/**
 * Resolves fast image sources for a single suggestion option.
 * Fallback chain (synchronous / cheap only — og-fetcher is handled separately):
 * 0. Global Firestore cache → instant hit.
 * 1. Verify the LLM-provided imageUrl via HEAD request.
 * 2. Fetch og:image from opt.url (non-booking-platform only).
 * 3. Wikipedia fallback by label name.
 *
 * Returns null when none of the fast sources yield an image; the caller should
 * then enqueue an og-queue item so the client fetches the image in the background.
 */
async function resolveOptionImageFast(
  opt: { id: string; label?: string; url?: string; imageUrl?: string },
  sem: ReturnType<typeof makeSemaphore>,
): Promise<ResolvedOptionData | null> {
  const cacheAndReturn = async (url: string, source: string): Promise<ResolvedOptionData> => {
    if (opt.label) void setCachedVenueImage(opt.label, url, source);
    return { imageUrl: url };
  };

  // Step 0: global cache.
  if (opt.label) {
    const cached = await getCachedVenueImage(opt.label);
    if (cached) {
      console.log(`[og-cache] hit for "${opt.label}": ${cached}`);
      return { imageUrl: cached };
    }
  }

  // Step 1: verify LLM-provided imageUrl.
  if (opt.imageUrl) {
    await sem.acquire();
    try {
      const valid = await verifyImageUrl(opt.imageUrl);
      if (valid) {
        console.log(`[og-enrich] verified direct image: ${opt.imageUrl}`);
        return cacheAndReturn(opt.imageUrl, "llm_direct");
      }
      console.log(`[og-enrich] dead/hallucinated imageUrl: ${opt.imageUrl} — skipping`);
    } finally {
      sem.release();
    }
  }

  // Step 2: fetch og:image from opt.url (non-OTA only).
  if (opt.url && !isBookingPlatformUrl(opt.url)) {
    const urlImage = await fetchOgImageUrl(opt.url);
    if (urlImage) {
      console.log(`[og-enrich] fetched og:image from url: ${urlImage}`);
      return cacheAndReturn(urlImage, "url");
    }
  }

  // Step 3: Wikipedia fallback.
  if (opt.label) {
    const wikiImage = await fetchWikipediaOgImage(opt.label);
    if (wikiImage) return cacheAndReturn(wikiImage, "wikipedia");
  }

  return null;
}

/**
 * Streams an NDJSON response:
 * - Line 1 immediately: `{ type:"result", reply, requestKind?, suggestions, provider, model }`
 *   where suggestions have NO imageUrl yet.
 * - Subsequent lines as each image resolves: `{ type:"image", recId, optionId, imageUrl }`
 *
 * This lets the client render suggestions instantly and patch images as they trickle in.
 */
function buildSuggestionsStreamResponse(opts: {
  reply: string;
  requestKind: ReturnType<typeof parseTripAssistantRequestKind>;
  provider: "anthropic" | "openai";
  model: string;
  suggestions: TripRecommendation[];
  dates?: { checkin: string; checkout: string; adults: number };
}): Response {
  const enc = new TextEncoder();
  const { suggestions, reply, requestKind, provider, model, dates } = opts;

  // Strip LLM-provided imageUrls from initial payload — they'll be verified async.
  const bareSuggestions = suggestions.map((rec) => ({
    ...rec,
    options: rec.options.map((opt) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { imageUrl: _img, ...rest } = opt as typeof opt & { imageUrl?: string };
      return rest;
    }),
  }));

  const stream = new ReadableStream({
    async start(controller) {
      const write = (obj: unknown) => {
        try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch { /* closed */ }
      };

      // 1. Send reply + bare suggestions immediately.
      write({
        type: "result",
        reply,
        ...(requestKind ? { requestKind } : {}),
        suggestions: bareSuggestions,
        provider,
        model,
      });

      // 2. Resolve fast images concurrently and stream patches as they arrive.
      //    Hotel (stay) options with a bookingUrl are handled client-side via og-queue
      //    so the stream can close without waiting for Playwright.
      const sem = makeSemaphore(IMAGE_LLM_CONCURRENCY);
      const ogQueue: { recId: string; optionId: string; label: string }[] = [];

      await Promise.allSettled(
        suggestions.flatMap((rec) =>
          rec.options.map(async (opt) => {
            const optAny = opt as { bookingUrl?: string; imageUrl?: string };
            const isHotel = rec.kind === "stay";
            const hasBookingUrl = isHotel && Boolean(optAny.bookingUrl && isBookingPlatformUrl(optAny.bookingUrl));

            const resolved = await resolveOptionImageFast(opt, sem);
            if (resolved) {
              write({ type: "image", recId: rec.id, optionId: opt.id, imageUrl: resolved.imageUrl });
            } else if (hasBookingUrl && opt.label) {
              // No fast image found — queue for client-side og-fetcher.
              ogQueue.push({ recId: rec.id, optionId: opt.id, label: opt.label });
            }
          })
        )
      );

      // 3. Emit og-queue so client can fetch hotel images in the background.
      if (ogQueue.length > 0) {
        write({ type: "og-queue", items: ogQueue, dates: dates ?? null });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type TripAssistantProvider = "openai" | "anthropic";

/** Server-only OpenAI secret (`sk-…` / `sk-proj-…`). */
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

/** Server-only Anthropic API key. */
function anthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim();
}

/** Default: current Haiku (Claude 4.5) per https://docs.anthropic.com/en/docs/about-claude/models/overview */
function anthropicModel(): string {
  return process.env.ANTHROPIC_CHAT_MODEL?.trim() || "claude-haiku-4-5";
}

/**
 * Max web searches per triggered message (markers or phrases).
 * Unset env -> 3 so marker syntax works without extra config; set `ANTHROPIC_WEB_SEARCH_MAX_USES=0` to hard-disable.
 */
function anthropicTripAssistantWebSearchMaxUses(): number {
  const raw = process.env.ANTHROPIC_WEB_SEARCH_MAX_USES?.trim();
  if (raw === undefined || raw === "") return 3;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), 10);
}

/**
 * `TRIP_ASSISTANT_PROVIDER`: exactly `openai` or `anthropic`.
 * If unset: use Anthropic when only `ANTHROPIC_API_KEY` is set; otherwise OpenAI.
 */
function resolveTripAssistantProvider(): TripAssistantProvider {
  const explicit = process.env.TRIP_ASSISTANT_PROVIDER?.trim().toLowerCase();
  if (explicit === "anthropic") return "anthropic";
  if (explicit === "openai") return "openai";
  const hasOpen = Boolean(openaiKey());
  const hasAnt = Boolean(anthropicKey());
  if (hasAnt && !hasOpen) return "anthropic";
  return "openai";
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

/** Strip `trip-suggestions` fence first (caller); then strip trailing `##…##` for clients. */
function finalizeTripAssistantReply(cleanedReply: string): {
  markdownInput: string;
  requestKind: ReturnType<typeof parseTripAssistantRequestKind>;
} {
  const requestKind = parseTripAssistantRequestKind(cleanedReply);
  const markdownInput = stripTripAssistantRequestKindMarker(cleanedReply);
  return { markdownInput, requestKind };
}

const OPENAI_BILLING_URL = "https://platform.openai.com/account/billing";

function parseOpenAiError(status: number, bodyText: string): { message: string; omitDetail: boolean } {
  const trimmed = bodyText.trim();
  try {
    const j = JSON.parse(trimmed) as {
      error?: { message?: string; code?: string; type?: string };
    };
    const code = j.error?.code;
    const typ = j.error?.type;
    if (code === "insufficient_quota" || typ === "insufficient_quota") {
      return {
        message: `OpenAI quota exceeded for this API key. Add billing or credits: ${OPENAI_BILLING_URL}`,
        omitDetail: true,
      };
    }
    if (code === "invalid_api_key") {
      return {
        message: "OpenAI rejected the API key — create one at https://platform.openai.com/api-keys",
        omitDetail: true,
      };
    }
    const msg = j.error?.message?.trim();
    if (msg) {
      return {
        message: msg.length > 280 ? `${msg.slice(0, 280)}…` : msg,
        omitDetail: false,
      };
    }
  } catch (e) {
    logCaughtExceptionServer(e, "tripAssistantRoute/parseOpenAiError/upstreamBody");
  }
  if (status === 401) {
    return {
      message: "OpenAI rejected the API key (check OPENAI_API_KEY / OPENAI_SA_KEY).",
      omitDetail: false,
    };
  }
  if (status === 429) {
    return {
      message: "OpenAI rate limit — wait a moment and try again.",
      omitDetail: false,
    };
  }
  if (status === 402 || status === 403) {
    return {
      message: `OpenAI account or permission issue — check ${OPENAI_BILLING_URL}`,
      omitDetail: false,
    };
  }
  return { message: `OpenAI returned HTTP ${status}.`, omitDetail: false };
}

const ANTHROPIC_CONSOLE = "https://console.anthropic.com/settings/plans";

const ANTHROPIC_MODELS_DOC = "https://docs.anthropic.com/en/docs/models-overview";

function parseAnthropicError(
  status: number,
  bodyText: string,
  attemptedModel: string
): { message: string; omitDetail: boolean } {
  const trimmed = bodyText.trim();
  try {
    const j = JSON.parse(trimmed) as { error?: { message?: string; type?: string } };
    const typ = j.error?.type;
    const msg = j.error?.message?.trim();
    const mLower = msg?.toLowerCase() ?? "";
    if (
      typ === "not_found_error" ||
      (msg && /^model:\s*\S+/i.test(msg)) ||
      (typ === "invalid_request_error" &&
        (mLower.includes("model") || mLower.includes("not found")))
    ) {
      return {
        message: `Anthropic did not accept model "${attemptedModel}". Set ANTHROPIC_CHAT_MODEL in env to a model id from ${ANTHROPIC_MODELS_DOC}`,
        omitDetail: true,
      };
    }
    if (typ === "authentication_error") {
      return {
        message: "Anthropic rejected the API key — check ANTHROPIC_API_KEY at https://console.anthropic.com/settings/keys",
        omitDetail: true,
      };
    }
    if (typ === "rate_limit_error") {
      return { message: "Anthropic rate limit — wait a moment and try again.", omitDetail: true };
    }
    if (typ === "overloaded_error") {
      return { message: "Anthropic is overloaded right now — please try again in a few seconds.", omitDetail: true };
    }
    if (typ === "invalid_request_error" && msg?.toLowerCase().includes("credit")) {
      return {
        message: `Anthropic billing or credits issue. Check ${ANTHROPIC_CONSOLE}`,
        omitDetail: true,
      };
    }
    if (msg) {
      return {
        message: msg.length > 280 ? `${msg.slice(0, 280)}…` : msg,
        omitDetail: false,
      };
    }
  } catch (e) {
    logCaughtExceptionServer(e, "tripAssistantRoute/parseAnthropicError/upstreamBody");
  }
  if (status === 401) {
    return { message: "Anthropic rejected the API key (check ANTHROPIC_API_KEY).", omitDetail: false };
  }
  if (status === 429) {
    return { message: "Anthropic rate limit — try again shortly.", omitDetail: false };
  }
  return { message: `Anthropic returned HTTP ${status}.`, omitDetail: false };
}

function parsePreferences(raw: unknown): UserPreferences | undefined {
  if (!isRecord(raw)) return undefined;
  const hobbies = Array.isArray(raw.hobbies)
    ? raw.hobbies.filter((x): x is string => typeof x === "string")
    : [];
  const activities = Array.isArray(raw.activities)
    ? raw.activities.filter((x): x is string => typeof x === "string")
    : [];
  const lifestyle = Array.isArray(raw.lifestyle)
    ? raw.lifestyle.filter((x): x is string => typeof x === "string")
    : [];
  return { hobbies, activities, lifestyle };
}

/** Minimal shape check so we never stringify huge arbitrary JSON as “trip”. */
function isTripPayload(x: unknown): x is Record<string, unknown> & {
  id: string;
  title: string;
  currency: string;
  startDate: string;
  endDate: string;
  travelers: unknown[];
  destinations: unknown[];
  steps: unknown[];
} {
  if (!isRecord(x)) return false;
  if (typeof x.id !== "string" || typeof x.title !== "string") return false;
  if (typeof x.currency !== "string") return false;
  if (typeof x.startDate !== "string" || typeof x.endDate !== "string") return false;
  if (!Array.isArray(x.travelers) || !Array.isArray(x.destinations) || !Array.isArray(x.steps))
    return false;
  return true;
}

function lastTripAssistantUserContent(
  turns: { role: "user" | "assistant"; content: string }[]
): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === "user") return turns[i].content;
  }
  return "";
}

function normalizeTripForPrompt(raw: Record<string, unknown>): Trip {
  const now = new Date().toISOString();
  return {
    ...(raw as unknown as Trip),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
  };
}

/**
 * POST JSON:
 * - `trip` (canonical trip object) + optional `preferences`, `contextAtMs`, `messages[]` (full thread)
 * - `messages`: `{ role: "user" | "assistant", content }[]` (no client-supplied system; server builds it)
 *
 * Provider: `TRIP_ASSISTANT_PROVIDER=openai` or `anthropic`. Default OpenAI unless only Anthropic key is set.
 */
export async function POST(req: NextRequest) {
  const provider = resolveTripAssistantProvider();

  if (provider === "openai" && !openaiKey()) {
    if (anthropicKey()) {
      return NextResponse.json(
        {
          error:
            "Trip assistant is configured for OpenAI but no OpenAI key is set. Set OPENAI_API_KEY, or use TRIP_ASSISTANT_PROVIDER=anthropic with ANTHROPIC_API_KEY.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error:
          "No LLM API key: set OPENAI_API_KEY (or OPENAI_SA_KEY), or ANTHROPIC_API_KEY with TRIP_ASSISTANT_PROVIDER=anthropic.",
      },
      { status: 503 }
    );
  }

  if (provider === "anthropic" && !anthropicKey()) {
    if (openaiKey()) {
      return NextResponse.json(
        {
          error:
            "TRIP_ASSISTANT_PROVIDER requests Anthropic but ANTHROPIC_API_KEY is missing. Add the key or set TRIP_ASSISTANT_PROVIDER=openai.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error:
          "No LLM API key: set ANTHROPIC_API_KEY, or OpenAI keys for the default provider.",
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Expected JSON object" }, { status: 400 });
  }

  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return NextResponse.json({ error: "messages[] is required" }, { status: 400 });
  }

  const tripRaw = body.trip;
  if (!isTripPayload(tripRaw)) {
    return NextResponse.json({ error: "trip object with id, title, steps, dates, etc. is required" }, { status: 400 });
  }

  const tripForPrompt = normalizeTripForPrompt(tripRaw);

  // Extract check-in / check-out dates for live Booking.com pricing
  const tripDates = (() => {
    const checkin = tripForPrompt.startDate?.slice(0, 10);
    const checkout = tripForPrompt.endDate?.slice(0, 10);
    if (!checkin || !checkout || checkin >= checkout) return undefined;
    const adults = Math.max(1, (tripForPrompt.travelers ?? []).length);
    return { checkin, checkout, adults };
  })();

  const contextAtMs =
    typeof body.contextAtMs === "number" && Number.isFinite(body.contextAtMs)
      ? body.contextAtMs
      : Date.now();
  const preferences = parsePreferences(body.preferences);

  const viewerPing = parseViewerDevicePing(body.viewerDevicePing, contextAtMs);
  const viewerEm =
    typeof body.viewerEmailLower === "string"
      ? body.viewerEmailLower.trim().toLowerCase().slice(0, 220)
      : null;
  const travelerLocationAppendix = buildTravelerLocationContextAppendix(tripForPrompt, {
    nowMs: contextAtMs,
    viewerDevicePing: viewerPing,
    viewerEmailLower: viewerEm,
  }).trim();

  const turnMessages: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of rawMessages) {
    if (!isRecord(m)) continue;
    const role = m.role === "user" || m.role === "assistant" ? m.role : null;
    const content = typeof m.content === "string" ? m.content : "";
    if (!role || !content.trim()) continue;
    turnMessages.push({ role, content: content.slice(0, 12000) });
  }

  if (turnMessages.length === 0) {
    return NextResponse.json({ error: "No valid user/assistant messages" }, { status: 400 });
  }

  const budgetGate = await assertMonthlyBudgetAllowsNewSpend();
  if (!budgetGate.ok) {
    return NextResponse.json({ error: budgetGate.message }, { status: 429 });
  }

  const lastUserText = lastTripAssistantUserContent(turnMessages);
  const webCap = anthropicTripAssistantWebSearchMaxUses();

  if (tripExplicitWebSyntaxRequested(lastUserText)) {
    if (provider !== "anthropic") {
      return NextResponse.json(
        {
          error:
            "Live web search markers (`=>`, `>=`, `<=`, `=<`) require Claude. Set TRIP_ASSISTANT_PROVIDER=anthropic and ANTHROPIC_API_KEY.",
          provider,
        },
        { status: 503 }
      );
    }
    if (webCap <= 0) {
      return NextResponse.json(
        {
          error:
            "Web search is disabled (ANTHROPIC_WEB_SEARCH_MAX_USES=0). Remove marker syntax or set a positive cap (e.g. 3) to use `=>`, `>=`, `<=`, or `=<`.",
          provider: "anthropic" as const,
        },
        { status: 503 }
      );
    }
  }
  // Web search is on for every Anthropic request when the cap allows it.
  const wantsLiveWeb = provider === "anthropic" && webCap > 0;

  let anthropicApiTurns = turnMessages;
  let anthropicWebUses = 0;

  if (wantsLiveWeb) {
    anthropicWebUses = webCap;
    const endsWeb = tripUserMessageEndsWithHashWeb(lastUserText);
    const inlineWeb = tripUserMessageInlineHashWeb(lastUserText);

    if (inlineWeb) {
      const key = anthropicKey()!;
      const refineSystem =
        buildTripAssistantSystemPrompt(tripForPrompt, {
          nowMs: contextAtMs,
          profilePreferences: preferences,
          anthropicWebSearchEnabled: false,
          travelerLocationContextAppendix: travelerLocationAppendix || undefined,
        }) + TRIP_ASSISTANT_WEB_REFINE_APPENDIX;

      const refined = await completeTripAssistantAnthropic({
        apiKey: key,
        model: anthropicModel(),
        system: refineSystem,
        turns: turnMessages,
        maxOutputTokens: 160,
        temperature: 0.35,
      });

      if (!refined.ok) {
        const parsed = parseAnthropicError(refined.status, refined.body, anthropicModel());
        return NextResponse.json(
          {
            error: parsed.message || "Could not normalize web-search marker query.",
            ...(parsed.omitDetail ? {} : { detail: refined.body.slice(0, 600) }),
            status: refined.status,
            provider: "anthropic" as const,
          },
          { status: refined.status >= 400 && refined.status < 600 ? refined.status : 502 }
        );
      }

      try {
        await recordLlmUsageUsd({
          provider: "anthropic",
          model: anthropicModel(),
          inputTokens: refined.usage.inputTokens,
          outputTokens: refined.usage.outputTokens,
        });
      } catch (e) {
        console.warn("[llmMonthlyBudget] record failed after refine hop", e);
      }

      const line = refined.text.trim();
      if (tripUserMessageEndsWithHashWeb(line)) {
        anthropicApiTurns = replaceLastUserContent(
          turnMessages,
          stripTrailingHashWebMarker(line)
        );
      } else {
        const strippedUser = stripTripWebSearchMarkers(lastUserText);
        anthropicApiTurns = replaceLastUserContent(
          turnMessages,
          strippedUser.length > 0 ? strippedUser : lastUserText
        );
      }
    } else if (endsWeb) {
      anthropicApiTurns = replaceLastUserStripTrailingHashWeb(turnMessages);
    } else {
      anthropicApiTurns = normalizeTripAssistantTurnsForWebTool(turnMessages, true);
    }
  }

  const rawClassified = body.classifiedMessageKind;
  const classifiedMessageKind: TripAssistantRequestKind | undefined =
    rawClassified === "general" || rawClassified === "specific" || rawClassified === "suggestions"
      ? rawClassified
      : undefined;

  const isScheduleCheck = body.scheduleCheck === true;

  let systemContent = buildTripAssistantSystemPrompt(tripForPrompt, {
    nowMs: contextAtMs,
    profilePreferences: preferences,
    anthropicWebSearchEnabled: wantsLiveWeb && !isScheduleCheck,
    travelerLocationContextAppendix: travelerLocationAppendix || undefined,
  });
  if (classifiedMessageKind === "suggestions") {
    systemContent += TRIP_ASSISTANT_CLASSIFIED_SUGGESTIONS_APPENDIX;
  }
  if (isScheduleCheck) {
    systemContent += SCHEDULE_CHECK_APPENDIX;
  }

  if (provider === "anthropic") {
    const key = anthropicKey()!;
    const webSearchMaxUses = anthropicWebUses;

    const isAnthropicOverloaded = (body: string, status: number) => {
      if (status === 529) return true;
      try {
        const j = JSON.parse(body) as { error?: { type?: string } };
        return j.error?.type === "overloaded_error";
      } catch { return false; }
    };

    let result = await completeTripAssistantAnthropic({
      apiKey: key,
      model: anthropicModel(),
      system: systemContent,
      turns: anthropicApiTurns,
      maxOutputTokens: webSearchMaxUses > 0 ? 8192 : 4096,
      temperature: 0.55,
      ...(webSearchMaxUses > 0 ? { webSearchMaxUses } : {}),
    });

    // Retry up to 2 times with backoff if Anthropic is momentarily overloaded.
    const RETRY_DELAYS_MS = [2_000, 5_000];
    for (const delay of RETRY_DELAYS_MS) {
      if (result.ok || !isAnthropicOverloaded(result.body, result.status)) break;
      console.warn(`[trip-assistant] Anthropic overloaded — retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      result = await completeTripAssistantAnthropic({
        apiKey: key,
        model: anthropicModel(),
        system: systemContent,
        turns: anthropicApiTurns,
        maxOutputTokens: webSearchMaxUses > 0 ? 8192 : 4096,
        temperature: 0.55,
        ...(webSearchMaxUses > 0 ? { webSearchMaxUses } : {}),
      });
    }

    if (!result.ok) {
      const parsed = parseAnthropicError(result.status, result.body, anthropicModel());
      const upstreamStatus = result.status >= 400 && result.status < 600 ? result.status : 502;
      return NextResponse.json(
        {
          error: parsed.message,
          ...(parsed.omitDetail ? {} : { detail: result.body.slice(0, 600) }),
          status: result.status,
          provider: "anthropic" as const,
        },
        { status: upstreamStatus }
      );
    }

    try {
      await recordLlmUsageUsd({
        provider: "anthropic",
        model: anthropicModel(),
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
    } catch (e) {
      console.warn("[llmMonthlyBudget] record failed after trip assistant", e);
    }

    /** Pull any `trip-suggestions` JSON block out of the raw reply BEFORE markdown
     * normalization — the parser tolerates the original fence formatting. */
    let { cleanedReply, suggestions } = extractTripSuggestionsFromReply(result.text);

    // One-shot retry when the turn was classified as suggestions but every recommendation
    // was dropped by the ≥3-options validator.
    // Skip retry when the model intentionally asked a clarifying question (wizard gate):
    // the clarify-first gate tells the model to end with ##specific## instead of emitting suggestions.
    const anthropicReplyKind = parseTripAssistantRequestKind(cleanedReply);
    if (classifiedMessageKind === "suggestions" && suggestions.length === 0 && anthropicReplyKind !== "specific") {
      const retryResult = await completeTripAssistantAnthropic({
        apiKey: key,
        model: anthropicModel(),
        system: systemContent + EXPAND_OPTIONS_RETRY_APPENDIX,
        turns: anthropicApiTurns,
        maxOutputTokens: 4096,
        temperature: 0.55,
      });
      if (retryResult.ok) {
        try {
          await recordLlmUsageUsd({
            provider: "anthropic",
            model: anthropicModel(),
            inputTokens: retryResult.usage.inputTokens,
            outputTokens: retryResult.usage.outputTokens,
          });
        } catch (e) {
          console.warn("[llmMonthlyBudget] record failed after suggestions retry", e);
        }
        const retry = extractTripSuggestionsFromReply(retryResult.text);
        if (retry.suggestions.length > 0) {
          suggestions = retry.suggestions;
        }
      }
    }

    // Schedule-check: extract patches before markdown normalization.
    const scheduleFixResult = isScheduleCheck ? extractScheduleFixFromReply(cleanedReply) : null;
    const replyForMarkdown = scheduleFixResult ? scheduleFixResult.cleanedReply : cleanedReply;

    const { markdownInput, requestKind } = finalizeTripAssistantReply(replyForMarkdown);
    const text = formatAssistantReplyForMarkdown(markdownInput);
    if (suggestions.length > 0) {
      console.log("[suggestions] raw from LLM:", JSON.stringify(suggestions.flatMap(s => s.options.map(o => ({ label: o.label, url: o.url, imageUrl: o.imageUrl })))));
      return buildSuggestionsStreamResponse({ reply: text, requestKind, provider: "anthropic", model: anthropicModel(), suggestions, dates: tripDates });
    }
    return NextResponse.json({
      reply: text,
      ...(requestKind ? { requestKind } : {}),
      provider: "anthropic" as const,
      model: anthropicModel(),
      ...(scheduleFixResult?.patches.length
        ? { scheduleFix: { patches: scheduleFixResult.patches, summary: scheduleFixResult.summary } }
        : {}),
    });
  }

  const outMessages: ChatMessage[] = [
    { role: "system", content: systemContent.slice(0, 100_000) },
    ...turnMessages.slice(-TRIP_ASSISTANT_OPENAI_MESSAGE_HISTORY_CAP),
  ];

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey()!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openaiModel(),
      messages: outMessages,
      temperature: 0.55,
      max_completion_tokens: 4096,
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    const upstreamStatus = res.status >= 400 && res.status < 600 ? res.status : 502;
    const parsed = parseOpenAiError(res.status, raw);
    return NextResponse.json(
      {
        error: parsed.message,
        ...(parsed.omitDetail ? {} : { detail: raw.slice(0, 600) }),
        status: res.status,
        provider: "openai" as const,
      },
      { status: upstreamStatus }
    );
  }

  let parsed: {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "Invalid OpenAI response", provider: "openai" }, { status: 502 });
  }

  const usage = parsed.usage;
  if (usage && typeof usage === "object") {
    try {
      await recordLlmUsageUsd({
        provider: "openai",
        model: openaiModel(),
        inputTokens: Number(usage.prompt_tokens) || 0,
        outputTokens: Number(usage.completion_tokens) || 0,
      });
    } catch (e) {
      console.warn("[llmMonthlyBudget] record failed after OpenAI trip assistant", e);
    }
  }

  const rawText = parsed.choices?.[0]?.message?.content?.trim() ?? "";
  let { cleanedReply, suggestions } = extractTripSuggestionsFromReply(rawText);

  // One-shot retry when the turn was classified as suggestions but every recommendation
  // was dropped by the ≥3-options validator.
  // Skip retry when the model intentionally asked a clarifying question (wizard gate):
  // the clarify-first gate tells the model to end with ##specific## instead of emitting suggestions.
  const openaiReplyKind = parseTripAssistantRequestKind(cleanedReply);
  if (classifiedMessageKind === "suggestions" && suggestions.length === 0 && openaiReplyKind !== "specific") {
    const retryMessages: ChatMessage[] = [
      { role: "system", content: (systemContent + EXPAND_OPTIONS_RETRY_APPENDIX).slice(0, 100_000) },
      ...turnMessages.slice(-TRIP_ASSISTANT_OPENAI_MESSAGE_HISTORY_CAP),
    ];
    const retryRes = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey()!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openaiModel(),
        messages: retryMessages,
        temperature: 0.55,
        max_completion_tokens: 4096,
      }),
    });
    if (retryRes.ok) {
      const retryRaw = await retryRes.text();
      let retryParsed: { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      try {
        retryParsed = JSON.parse(retryRaw) as typeof retryParsed;
        const retryUsage = retryParsed.usage;
        if (retryUsage) {
          await recordLlmUsageUsd({
            provider: "openai",
            model: openaiModel(),
            inputTokens: Number(retryUsage.prompt_tokens) || 0,
            outputTokens: Number(retryUsage.completion_tokens) || 0,
          }).catch((e) => console.warn("[llmMonthlyBudget] record failed after OpenAI retry", e));
        }
        const retryText = retryParsed.choices?.[0]?.message?.content?.trim() ?? "";
        const retry = extractTripSuggestionsFromReply(retryText);
        if (retry.suggestions.length > 0) {
          suggestions = retry.suggestions;
        }
      } catch (e) {
        logCaughtExceptionServer(e, "tripAssistantRoute/openaiSuggestionsRetry/parseJson");
      }
    }
  }

  const scheduleFixResultOai = isScheduleCheck ? extractScheduleFixFromReply(cleanedReply) : null;
  const replyForMarkdownOai = scheduleFixResultOai ? scheduleFixResultOai.cleanedReply : cleanedReply;

  const { markdownInput, requestKind } = finalizeTripAssistantReply(replyForMarkdownOai);
  const text = formatAssistantReplyForMarkdown(markdownInput);
  if (suggestions.length > 0) {
    console.log("[suggestions] raw from LLM:", JSON.stringify(suggestions.flatMap(s => s.options.map(o => ({ label: o.label, url: o.url, imageUrl: o.imageUrl })))));
    return buildSuggestionsStreamResponse({ reply: text, requestKind, provider: "openai", model: openaiModel(), suggestions, dates: tripDates });
  }
  return NextResponse.json({
    reply: text,
    ...(requestKind ? { requestKind } : {}),
    provider: "openai" as const,
    model: openaiModel(),
    ...(scheduleFixResultOai?.patches.length
      ? { scheduleFix: { patches: scheduleFixResultOai.patches, summary: scheduleFixResultOai.summary } }
      : {}),
  });
}
