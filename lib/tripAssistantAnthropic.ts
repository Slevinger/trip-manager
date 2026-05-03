const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** Max continuation POSTs after `pause_turn` (server tools — long-running turn). */
const PAUSE_TURN_MAX_STEPS = 8;

export type AnthropicCompleteResult =
  | { ok: true; text: string }
  | { ok: false; status: number; body: string };

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

function extractTextBlocks(content: unknown[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

type ApiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | unknown[] };

/**
 * Anthropic Messages API — same trip thread as OpenAI (system + user/assistant turns).
 * Server tools (`web_search`): handles `pause_turn` by continuing the turn per Anthropic docs.
 * @see https://docs.anthropic.com/en/api/messages
 * @see https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/server-tools
 */
export async function completeTripAssistantAnthropic(opts: {
  apiKey: string;
  model: string;
  system: string;
  turns: { role: "user" | "assistant"; content: string }[];
  maxOutputTokens: number;
  temperature: number;
  /** Anthropic server-side web search (extra billing per search). Omit or ≤0 to disable. */
  webSearchMaxUses?: number;
}): Promise<AnthropicCompleteResult> {
  const maxUsesRaw =
    typeof opts.webSearchMaxUses === "number" && Number.isFinite(opts.webSearchMaxUses)
      ? Math.floor(opts.webSearchMaxUses)
      : 0;
  const webSearchUses = maxUsesRaw > 0 ? Math.min(maxUsesRaw, 10) : 0;

  const toolsPayload =
    webSearchUses > 0
      ? [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: webSearchUses,
          },
        ]
      : undefined;

  let apiMessages: ApiMessage[] = opts.turns.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  for (let step = 0; step < PAUSE_TURN_MAX_STEPS; step++) {
    const body: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxOutputTokens,
      temperature: opts.temperature,
      system: opts.system.slice(0, 100_000),
      messages: apiMessages,
    };

    if (toolsPayload) {
      body.tools = toolsPayload;
      // First hop only: require exactly one tool call so Haiku doesn’t skip `web_search`
      // and answer with “search Google yourself”. Continuations after `pause_turn` omit this
      // so the model can finish with plain text using results already in context.
      if (step === 0) {
        body.tool_choice = { type: "any", disable_parallel_tool_use: true };
      }
    }

    const res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, body: raw };
    }

    let data: { content?: unknown; stop_reason?: string };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      return { ok: false, status: 502, body: "Invalid Anthropic JSON response" };
    }

    const content = Array.isArray(data.content) ? data.content : [];

    if (data.stop_reason === "pause_turn") {
      apiMessages = [...apiMessages, { role: "assistant", content }];
      continue;
    }

    return { ok: true, text: extractTextBlocks(content) };
  }

  return {
    ok: false,
    status: 502,
    body: "Anthropic server-tool turn exceeded pause_turn continuation limit",
  };
}
