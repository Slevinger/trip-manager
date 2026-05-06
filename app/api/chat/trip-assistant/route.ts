import { NextRequest, NextResponse } from "next/server";
import {
  buildTripAssistantSystemPrompt,
  TRIP_ASSISTANT_WEB_REFINE_APPENDIX,
} from "@/lib/tripAssistantPrompt";
import { extractTripSuggestionsFromReply } from "@/lib/tripAssistantSuggestionSchema";
import { completeTripAssistantAnthropic } from "@/lib/tripAssistantAnthropic";
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
import type { Trip, UserPreferences } from "@/lib/types/trip";
import { formatAssistantReplyForMarkdown } from "@/lib/formatAssistantReplyMarkdown";
import { assertMonthlyBudgetAllowsNewSpend, recordLlmUsageUsd } from "@/lib/llmMonthlyBudget";
import { TRIP_ASSISTANT_OPENAI_MESSAGE_HISTORY_CAP } from "@/lib/tripChatEvolveGate";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

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
  } catch {
    /* not JSON */
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
  } catch {
    /* not JSON */
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

  const contextAtMs =
    typeof body.contextAtMs === "number" && Number.isFinite(body.contextAtMs)
      ? body.contextAtMs
      : Date.now();
  const preferences = parsePreferences(body.preferences);

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
  const wantsLiveWeb =
    provider === "anthropic" &&
    webCap > 0 &&
    tripUserMessageRequestsWebSearch(lastUserText);

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

  const systemContent = buildTripAssistantSystemPrompt(tripForPrompt, {
    nowMs: contextAtMs,
    profilePreferences: preferences,
    anthropicWebSearchEnabled: anthropicWebUses > 0,
  });

  if (provider === "anthropic") {
    const key = anthropicKey()!;
    const webSearchMaxUses = anthropicWebUses;
    const result = await completeTripAssistantAnthropic({
      apiKey: key,
      model: anthropicModel(),
      system: systemContent,
      turns: anthropicApiTurns,
      maxOutputTokens: webSearchMaxUses > 0 ? 8192 : 4096,
      temperature: 0.55,
      ...(webSearchMaxUses > 0 ? { webSearchMaxUses } : {}),
    });

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
    const { cleanedReply, suggestions } = extractTripSuggestionsFromReply(result.text);
    const text = formatAssistantReplyForMarkdown(cleanedReply);
    return NextResponse.json({
      reply: text,
      ...(suggestions.length > 0 ? { suggestions } : {}),
      provider: "anthropic" as const,
      model: anthropicModel(),
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
  const { cleanedReply, suggestions } = extractTripSuggestionsFromReply(rawText);
  const text = formatAssistantReplyForMarkdown(cleanedReply);
  return NextResponse.json({
    reply: text,
    ...(suggestions.length > 0 ? { suggestions } : {}),
    provider: "openai" as const,
    model: openaiModel(),
  });
}
