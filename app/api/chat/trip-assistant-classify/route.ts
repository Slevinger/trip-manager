import { NextRequest, NextResponse } from "next/server";
import { completeTripAssistantAnthropic } from "@/lib/tripAssistantAnthropic";
import { assertMonthlyBudgetAllowsNewSpend, recordLlmUsageUsd } from "@/lib/llmMonthlyBudget";

/**
 * Tiny LLM router: classifies a user message into "general" (personal / cross-trip)
 * vs "specific" (about THIS trip's concrete details).
 *
 * Used by the trip assistant chat dock to decide whether to attach the user's
 * `__global__` cross-trip memory to the main assistant call. Kept on a small/cheap
 * model with `max_tokens ≈ 4` so the per-turn overhead is negligible.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

type Provider = "openai" | "anthropic";
type Kind = "general" | "specific" | "suggestions";

function openaiKey(): string | undefined {
  return (
    process.env.OPENAI_SA_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    undefined
  );
}

function openaiModel(): string {
  return (
    process.env.TRIP_ASSISTANT_CLASSIFY_OPENAI_MODEL?.trim() ||
    process.env.OPENAI_CHAT_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

function anthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim();
}

function anthropicModel(): string {
  return (
    process.env.TRIP_ASSISTANT_CLASSIFY_ANTHROPIC_MODEL?.trim() ||
    process.env.ANTHROPIC_CHAT_MODEL?.trim() ||
    "claude-haiku-4-5"
  );
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

const SYSTEM = [
  "You are a router for a travel-assistant chat. Read ONLY the user's latest message",
  "(plus the optional trip title and last few turns) and decide how to route it.",
  "",
  "Output EXACTLY one lowercase word, with no quotes, no punctuation, no explanation:",
  "  general      → the message is about the USER (likes, dislikes, hobbies, music, food",
  "                 preferences, lifestyle, pace, budget style), or cross-trip questions",
  "                 (e.g. \"where should I travel next\", \"plan my next trip\", \"remember\",",
  "                 \"in general I prefer ...\", generic destination ideas).",
  "  specific     → the message is about THIS trip's concrete details — a step, place,",
  "                 date, time, booking, route, price, schedule, document, or a simple",
  "                 factual question grounded in the current itinerary.",
  "  suggestions  → the user is explicitly asking the assistant to PROPOSE concrete",
  "                 additions to THIS trip's queue: ideas for hotels/stays, transit options,",
  "                 day-trip activities, restaurants, museums, etc. Triggers include",
  "                 \"suggest\", \"recommend X for me\", \"what should I add\", \"give me a few",
  "                 options for...\", \"propose...\", and similar imperative requests where",
  "                 the natural answer is a small set of actionable, structured proposals.",
  "",
  "If `suggestions` and `specific` both apply (e.g. \"suggest a hotel for night 3\"),",
  "prefer `suggestions`. If `general` and `suggestions` both apply (e.g. \"suggest my next",
  "trip\"), prefer `general`. If still unclear, default to specific.",
  "Never output anything other than the single word `general`, `specific`, or `suggestions`.",
].join("\n");

function buildUserBlock(input: {
  latestUserText: string;
  tripTitle?: string;
  recentTurns?: { role: "user" | "assistant"; content: string }[];
}): string {
  const turns = (input.recentTurns ?? []).slice(-4);
  const transcript = turns
    .map((t) => `${t.role === "assistant" ? "Assistant" : "User"}: ${(t.content ?? "").trim().slice(0, 600)}`)
    .join("\n");
  const tripBit = input.tripTitle?.trim() ? `Current trip title: ${input.tripTitle.trim()}\n` : "";
  const transcriptBit = transcript ? `Recent turns (oldest → newest):\n${transcript}\n` : "";
  return `${tripBit}${transcriptBit}Latest user message:\n${(input.latestUserText ?? "").trim().slice(0, 2000)}`;
}

function parseKind(raw: string): Kind {
  const v = (raw ?? "").trim().toLowerCase();
  if (v.startsWith("suggestion")) return "suggestions";
  if (v.startsWith("general")) return "general";
  // Anything else (including "specific" or noise) → specific. Safe default.
  return "specific";
}

export async function POST(req: NextRequest) {
  let body: {
    latestUserText?: unknown;
    tripTitle?: unknown;
    recentTurns?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const latestUserText = typeof body.latestUserText === "string" ? body.latestUserText.trim() : "";
  if (!latestUserText) {
    return NextResponse.json({ error: "Missing latestUserText" }, { status: 400 });
  }
  const tripTitle = typeof body.tripTitle === "string" ? body.tripTitle : undefined;
  const recentTurns: { role: "user" | "assistant"; content: string }[] = Array.isArray(body.recentTurns)
    ? (body.recentTurns as unknown[])
        .filter(
          (t): t is { role: "user" | "assistant"; content: string } =>
            t != null &&
            typeof t === "object" &&
            (((t as { role?: unknown }).role === "user") ||
              ((t as { role?: unknown }).role === "assistant")) &&
            typeof (t as { content?: unknown }).content === "string"
        )
        .slice(-8)
    : [];

  const userBlock = buildUserBlock({ latestUserText, tripTitle, recentTurns });

  const budgetGate = await assertMonthlyBudgetAllowsNewSpend();
  if (!budgetGate.ok) {
    return NextResponse.json({ error: budgetGate.message, kind: "specific" as Kind }, { status: 429 });
  }

  const provider = resolveProvider();

  if (provider === "anthropic") {
    const key = anthropicKey();
    if (!key) {
      return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY", kind: "specific" as Kind }, { status: 503 });
    }
    const r = await completeTripAssistantAnthropic({
      apiKey: key,
      model: anthropicModel(),
      system: SYSTEM,
      turns: [{ role: "user", content: userBlock }],
      maxOutputTokens: 12,
      temperature: 0,
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: "Anthropic classify failed", detail: r.body?.slice?.(0, 600), kind: "specific" as Kind },
        { status: r.status >= 400 && r.status < 600 ? r.status : 502 }
      );
    }
    if (r.usage) {
      try {
        await recordLlmUsageUsd({
          provider: "anthropic",
          model: anthropicModel(),
          inputTokens: r.usage.inputTokens,
          outputTokens: r.usage.outputTokens,
        });
      } catch {}
    }
    return NextResponse.json({ kind: parseKind(r.text) });
  }

  const key = openaiKey();
  if (!key) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY", kind: "specific" as Kind }, { status: 503 });
  }

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: openaiModel(),
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userBlock },
      ],
      temperature: 0,
      max_completion_tokens: 12,
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { error: `OpenAI returned HTTP ${res.status}.`, detail: raw.slice(0, 600), kind: "specific" as Kind },
      { status: res.status >= 400 && res.status < 600 ? res.status : 502 }
    );
  }
  let parsed: {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "Invalid OpenAI response", kind: "specific" as Kind }, { status: 502 });
  }
  const text = parsed.choices?.[0]?.message?.content?.trim() ?? "";
  if (parsed.usage) {
    try {
      await recordLlmUsageUsd({
        provider: "openai",
        model: openaiModel(),
        inputTokens: Number(parsed.usage.prompt_tokens) || 0,
        outputTokens: Number(parsed.usage.completion_tokens) || 0,
      });
    } catch {}
  }
  return NextResponse.json({ kind: parseKind(text) });
}
