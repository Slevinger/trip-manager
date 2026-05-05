import { NextRequest, NextResponse } from "next/server";
import { completeTripAssistantAnthropic } from "@/lib/tripAssistantAnthropic";
import {
  refuseRedundantTripMemoryEvolveFromTurns,
  type TripMemoryEvolveTurn,
} from "@/lib/tripChatEvolveGate";
import { capEvolveSummaryChars, TRIP_MEMORY_EVOLVE_SYSTEM } from "@/lib/tripMemoryEvolvePrompt";
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

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

function detectLanguageOverrideFromLatestUser(turns: TripMemoryEvolveTurn[]): string {
  // Heuristic: use script presence from the latest user message.
  // This avoids relying on “dominant language” when we label turns with English prefixes.
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role !== "user") continue;
    const s = t.content ?? "";
    if (/[\u0590-\u05FF]/.test(s)) return "Hebrew";
    if (/[\u0600-\u06FF\u0750-\u077F]/.test(s)) return "Arabic";
    if (/[\u0400-\u04FF]/.test(s)) return "Russian";
    return "English";
  }
  return "English";
}

function formatTranscriptForEvolve(lines: TripMemoryEvolveTurn[]): string {
  const parts: string[] = [];
  for (const m of lines) {
    const label = m.role === "assistant" ? "Assistant" : "User";
    parts.push(`${label}: ${m.content.trim()}`);
  }
  return parts.join("\n\n");
}

/**
 * POST JSON: `{ "messages": [ { "role": "user"|"assistant", "content": "..." }, ... ] }`
 * Returns `{ "summary": "..." }` — one compressed note (not a live reply).
 * Itinerary context is not injected here; the live trip payload is sent separately on assistant turns.
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

  const turnMessages: TripMemoryEvolveTurn[] = [];
  for (const m of rawMessages) {
    if (!isRecord(m)) continue;
    const role = m.role === "user" || m.role === "assistant" ? m.role : null;
    const content = typeof m.content === "string" ? m.content : "";
    if (!role || !content.trim()) continue;
    const row: TripMemoryEvolveTurn = { role, content: content.slice(0, 12000) };
    if (m.memoryCompressed === true && role === "assistant") {
      row.memoryCompressed = true;
    }
    turnMessages.push(row);
  }

  if (turnMessages.length === 0) {
    return NextResponse.json({ error: "No valid user/assistant messages" }, { status: 400 });
  }

  if (refuseRedundantTripMemoryEvolveFromTurns(turnMessages)) {
    return NextResponse.json(
      {
        error:
          "Chat is already a single compressed note. Add more messages, or compress again once you have 40+ lines (model history window).",
        code: "evolve_redundant",
      },
      { status: 409 }
    );
  }

  const budgetGate = await assertMonthlyBudgetAllowsNewSpend();
  if (!budgetGate.ok) {
    return NextResponse.json({ error: budgetGate.message }, { status: 429 });
  }

  const userBlock = formatTranscriptForEvolve(turnMessages).slice(0, 200_000);
  const languageOverride = detectLanguageOverrideFromLatestUser(turnMessages);
  const systemWithLanguageOverride =
    TRIP_MEMORY_EVOLVE_SYSTEM +
    `\n\n### Language override (server-detected)\nLatest user message appears to be in: ${languageOverride}.\nWrite ALL section prose in ${languageOverride}.\nKeep the section headers exactly as shown (LEGEND:, FROM_WEB_OR_VERIFIED:, CHAT_ONLY_MEMORY:, OPEN_LOOSE_ENDS:). URLs and proper nouns must remain unchanged.`;

  if (provider === "anthropic") {
    const key = anthropicKey()!;
    const result = await completeTripAssistantAnthropic({
      apiKey: key,
      model: anthropicModel(),
      system: systemWithLanguageOverride,
      turns: [{ role: "user", content: userBlock }],
      maxOutputTokens: 4096,
      temperature: 0.35,
    });

    if (!result.ok) {
      const upstreamStatus = result.status >= 400 && result.status < 600 ? result.status : 502;
      return NextResponse.json(
        {
          error: "Anthropic request failed while evolving memory.",
          detail: result.body.slice(0, 600),
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
      console.warn("[llmMonthlyBudget] record failed after memory evolve", e);
    }

    const text = capEvolveSummaryChars(result.text);
    return NextResponse.json({
      summary: text,
      provider: "anthropic" as const,
      model: anthropicModel(),
    });
  }

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey()!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openaiModel(),
      messages: [
        { role: "system", content: systemWithLanguageOverride },
        { role: "user", content: userBlock },
      ],
      temperature: 0.35,
      max_completion_tokens: 4096,
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    const upstreamStatus = res.status >= 400 && res.status < 600 ? res.status : 502;
    return NextResponse.json(
      {
        error: `OpenAI returned HTTP ${res.status}.`,
        detail: raw.slice(0, 600),
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

  const oUsage = parsed.usage;
  if (oUsage && typeof oUsage === "object") {
    try {
      await recordLlmUsageUsd({
        provider: "openai",
        model: openaiModel(),
        inputTokens: Number(oUsage.prompt_tokens) || 0,
        outputTokens: Number(oUsage.completion_tokens) || 0,
      });
    } catch (e) {
      console.warn("[llmMonthlyBudget] record failed after OpenAI memory evolve", e);
    }
  }

  const text = capEvolveSummaryChars(parsed.choices?.[0]?.message?.content?.trim() ?? "");
  return NextResponse.json({
    summary: text,
    provider: "openai" as const,
    model: openaiModel(),
  });
}
