import { NextRequest, NextResponse } from "next/server";
import { completeTripAssistantAnthropic } from "@/lib/tripAssistantAnthropic";
import { TRIP_MEMORY_EVOLVE_SYSTEM } from "@/lib/tripMemoryEvolvePrompt";

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

const EVOLVE_MAX_WORDS = 400;

function capReplyWords(text: string, maxWords: number): string {
  const t = text.trim();
  if (!t) return t;
  const words = t.split(/\s+/);
  if (words.length <= maxWords) return t;
  return `${words.slice(0, maxWords).join(" ")}…`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

function formatTranscriptForEvolve(
  lines: { role: "user" | "assistant"; content: string }[]
): string {
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

  const userBlock = formatTranscriptForEvolve(turnMessages);

  if (provider === "anthropic") {
    const key = anthropicKey()!;
    const result = await completeTripAssistantAnthropic({
      apiKey: key,
      model: anthropicModel(),
      system: TRIP_MEMORY_EVOLVE_SYSTEM,
      turns: [{ role: "user", content: userBlock.slice(0, 200_000) }],
      maxOutputTokens: 2048,
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

    const text = capReplyWords(result.text, EVOLVE_MAX_WORDS);
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
        { role: "system", content: TRIP_MEMORY_EVOLVE_SYSTEM },
        { role: "user", content: userBlock.slice(0, 200_000) },
      ],
      temperature: 0.35,
      max_completion_tokens: 2048,
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

  let parsed: { choices?: { message?: { content?: string } }[] };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "Invalid OpenAI response", provider: "openai" }, { status: 502 });
  }

  const text = capReplyWords(parsed.choices?.[0]?.message?.content?.trim() ?? "", EVOLVE_MAX_WORDS);
  return NextResponse.json({
    summary: text,
    provider: "openai" as const,
    model: openaiModel(),
  });
}
