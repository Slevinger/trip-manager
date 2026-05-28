import { NextRequest, NextResponse } from "next/server";
import { logCaughtExceptionServer } from "@/lib/logCaughtExceptionServer";
import { buildTripAssistantSystemPrompt } from "@/lib/tripAssistantPrompt";
import { buildTripRecommendationSchemaPrompt, extractTripSuggestionsFromReply } from "@/lib/tripAssistantSuggestionSchema";
import { completeTripAssistantAnthropic } from "@/lib/tripAssistantAnthropic";
import { assertMonthlyBudgetAllowsNewSpend, recordLlmUsageUsd } from "@/lib/llmMonthlyBudget";
import type { Trip, TripRecommendation, TripRecommendationOption } from "@/lib/types/trip";

type Provider = "openai" | "anthropic";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

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

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

function safeString(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function safeTrip(x: unknown): Trip | null {
  if (!isRecord(x)) return null;
  if (typeof x.id !== "string") return null;
  if (!Array.isArray((x as any).steps) || !Array.isArray((x as any).destinations)) return null;
  return x as unknown as Trip;
}

async function placesSearch(origin: string, q: string, lang: string) {
  const url = new URL("/api/places/search", origin);
  url.searchParams.set("q", q);
  url.searchParams.set("lang", lang || "en");
  const res = await fetch(url.toString(), { cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as { results?: any[] };
  return Array.isArray(j.results) ? j.results.slice(0, 6) : [];
}

export async function POST(req: NextRequest) {
  let body: { trip?: unknown; approved?: unknown; lang?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const trip = safeTrip(body.trip);
  if (!trip) return NextResponse.json({ error: "Missing trip" }, { status: 400 });

  const approved = isRecord(body.approved) ? body.approved : null;
  if (!approved) return NextResponse.json({ error: "Missing approved" }, { status: 400 });

  const kind = safeString(approved.kind) as TripRecommendation["kind"];
  if (kind !== "stay" && kind !== "transit" && kind !== "activity") {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  const option = isRecord(approved.option) ? approved.option : null;
  if (!option) return NextResponse.json({ error: "Missing approved.option" }, { status: 400 });

  const interval = (option as any).interval as TripRecommendationOption["interval"] | undefined;
  if (!interval || typeof interval !== "object") {
    return NextResponse.json({ error: "Missing approved.option.interval" }, { status: 400 });
  }

  const lang = typeof body.lang === "string" ? body.lang.trim().toLowerCase() : "en";
  const origin = new URL(req.url).origin;

  const title = safeString((interval as any).title).trim();
  const comment = safeString((interval as any).comment).trim();
  const queryBase = title || comment || "activity";

  const destinationHint =
    safeString((interval as any).location).trim() ||
    safeString((interval as any).destinationId).trim() ||
    safeString((interval as any).fromDestinationId).trim() ||
    safeString((interval as any).toDestinationId).trim();

  const placeQuery = destinationHint ? `${queryBase} ${destinationHint}` : queryBase;
  const placeCandidates = await placesSearch(origin, placeQuery.slice(0, 160), lang);

  const budgetGate = await assertMonthlyBudgetAllowsNewSpend();
  if (!budgetGate.ok) {
    return NextResponse.json({ error: budgetGate.message }, { status: 429 });
  }

  const system =
    buildTripAssistantSystemPrompt(trip, { nowMs: Date.now() }) +
    "\n\n" +
    buildTripRecommendationSchemaPrompt() +
    "\n\n" +
    [
      "TASK: Tighten an already-approved suggestion into a concrete follow-up recommendation card.",
      "- Use the place candidates below if you need a specific location/operator/spot.",
      "- You MAY reorder within the day if it improves schedule fit, but stay within trip start/end dates and avoid obvious overlaps.",
      "- Output ONLY the fenced ```trip-suggestions JSON block (no prose).",
      "- Produce exactly 1 TripRecommendation with 1 option (same kind as approved).",
      "- Set interval.startTime/endTime precisely (ISO). If you cannot, keep the same times but add a clear note field explaining what is unknown.",
      "- If you reference an existing destination, use its id; only add new destinations via option.destinations.",
      "- Set recommendation.source = \"tighten\".",
    ].join("\n");

  const user = [
    "Approved option snapshot:",
    "```json",
    JSON.stringify(
      {
        kind,
        option: {
          label: option.label,
          note: option.note,
          hostStayStepId: (option as any).hostStayStepId,
          interval,
        },
      },
      null,
      2
    ),
    "```",
    "",
    "Place candidates (top matches):",
    "```json",
    JSON.stringify(placeCandidates, null, 2),
    "```",
  ].join("\n");

  const provider = resolveProvider();

  if (provider === "anthropic") {
    const key = anthropicKey();
    if (!key) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 503 });
    const r = await completeTripAssistantAnthropic({
      apiKey: key,
      model: anthropicModel(),
      system,
      turns: [{ role: "user", content: user }],
      maxOutputTokens: 1400,
      temperature: 0.2,
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: "Anthropic tighten failed", detail: r.body?.slice?.(0, 500) },
        { status: r.status >= 400 && r.status < 600 ? r.status : 502 }
      );
    }
    try {
      await recordLlmUsageUsd({
        provider: "anthropic",
        model: anthropicModel(),
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
      });
    } catch (e) {
      logCaughtExceptionServer(e, "tightenRecommendationRoute/recordLlmUsageUsd/anthropic");
    }

    const extracted = extractTripSuggestionsFromReply(r.text);
    const tightened = extracted.suggestions?.[0];
    if (!tightened) {
      return NextResponse.json({ error: "No tightened recommendation returned by model." }, { status: 502 });
    }
    const recommendation: TripRecommendation = { ...tightened, source: "tighten" };
    return NextResponse.json({ recommendation });
  }

  const key = openaiKey();
  if (!key) return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 503 });

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: openaiModel(),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_completion_tokens: 1200,
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    return NextResponse.json({ error: `OpenAI returned HTTP ${res.status}.`, detail: raw.slice(0, 500) }, { status: 502 });
  }

  let parsed: {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "Invalid OpenAI response" }, { status: 502 });
  }

  const reply = parsed.choices?.[0]?.message?.content?.trim() ?? "";
  if (parsed.usage) {
    try {
      await recordLlmUsageUsd({
        provider: "openai",
        model: openaiModel(),
        inputTokens: Number(parsed.usage.prompt_tokens) || 0,
        outputTokens: Number(parsed.usage.completion_tokens) || 0,
      });
    } catch (e) {
      logCaughtExceptionServer(e, "tightenRecommendationRoute/recordLlmUsageUsd/openai");
    }
  }

  const extracted = extractTripSuggestionsFromReply(reply);
  const tightened = extracted.suggestions?.[0];
  if (!tightened) {
    return NextResponse.json({ error: "No tightened recommendation returned by model." }, { status: 502 });
  }

  const recommendation: TripRecommendation = { ...tightened, source: "tighten" };
  return NextResponse.json({ recommendation });
}

