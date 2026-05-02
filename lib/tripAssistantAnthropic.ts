const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export type AnthropicCompleteResult =
  | { ok: true; text: string }
  | { ok: false; status: number; body: string };

/**
 * Anthropic Messages API — same trip thread as OpenAI (system + user/assistant turns).
 * @see https://docs.anthropic.com/en/api/messages
 */
export async function completeTripAssistantAnthropic(opts: {
  apiKey: string;
  model: string;
  system: string;
  turns: { role: "user" | "assistant"; content: string }[];
  maxOutputTokens: number;
  temperature: number;
}): Promise<AnthropicCompleteResult> {
  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxOutputTokens,
      temperature: opts.temperature,
      system: opts.system.slice(0, 100_000),
      messages: opts.turns.map((t) => ({
        role: t.role,
        content: t.content,
      })),
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: raw };
  }

  let data: { content?: Array<{ type?: string; text?: string }> };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return { ok: false, status: 502, body: "Invalid Anthropic JSON response" };
  }

  const parts: string[] = [];
  for (const block of data.content ?? []) {
    if (block?.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return { ok: true, text: parts.join("\n").trim() };
}
