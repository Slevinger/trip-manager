/**
 * Trip assistant: live web search is opt-in via `#web` suffix, `[web]`, or explicit phrases.
 */

/** Normalize Unicode hash look-alikes (e.g. U+FF03) to `#` for `#web` detection. */
export function normalizeTripAssistantHashChars(text: string): string {
  return text.replace(/\uFF03/g, "#");
}

/** User typed `#web` / `[web]` — fail fast if web search cannot run (wrong provider / cap 0). */
export function tripExplicitWebSyntaxRequested(text: string): boolean {
  const n = normalizeTripAssistantHashChars(text).trim();
  return /(?:^|\s)#web\b/i.test(n) || /\[web\]/i.test(n);
}

/** `#web` appears as a token (not `#website`). */
export function tripUserMessageContainsHashWeb(text: string): boolean {
  const t = normalizeTripAssistantHashChars(text).trim();
  return /(?:^|\s)#web\b/i.test(t);
}

/** Message ends with `#web` (optional spaces) — server strips this and enables web_search. */
export function tripUserMessageEndsWithHashWeb(text: string): boolean {
  const t = normalizeTripAssistantHashChars(text).trimEnd();
  return /\s*#web\b\s*$/i.test(t);
}

/** `#web` present but not at end → server runs a refinement hop, then web_search. */
export function tripUserMessageInlineHashWeb(text: string): boolean {
  return tripUserMessageContainsHashWeb(text) && !tripUserMessageEndsWithHashWeb(text);
}

/** Remove trailing `#web` only (preserve `#website`, mid-text). */
export function stripTrailingHashWebMarker(content: string): string {
  return normalizeTripAssistantHashChars(content)
    .replace(/\s*#web\b\s*$/i, "")
    .trim();
}

/** Strip `#web` / `[web]` everywhere (used when normalizing phrase-triggered turns). */
export function stripTripWebSearchMarkers(content: string): string {
  return normalizeTripAssistantHashChars(content)
    .replace(/\s*\[web\]\s*/gi, " ")
    .replace(/\s*#web\b\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * `[web]` or natural-language web request (does not depend on `#web` — that uses suffix/refine rules).
 */
export function tripBracketOrPhraseRequestsWeb(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\[web\]/i.test(t)) return true;

  const lower = t.toLowerCase();
  const phrases = [
    /\bsearch\s+the\s+(web|internet)\b/,
    /\bsearch\s+online\b/,
    /\b(web|internet)\s+search\b/,
    /\blook\s+(that|this)\s+up\s+(on\s+)?(the\s+)?(web|internet|google)\b/,
    /\blook\s+it\s+up\s+online\b/,
    /\bcheck\s+(online|google|the\s+web)\b/,
    /\bfind\s+(that|this)\s+online\b/,
    /\bcan\s+you\s+search(\s+the\s+(web|internet))?\b/,
    /\bplease\s+search(\s+the\s+(web|internet))?\b/,
    /\bsearch\s+on\s+google\b/,
    /\bgoogle\s+for\b/,
  ];

  return phrases.some((re) => re.test(lower));
}

/** Any trigger that can enable Anthropic `web_search` (suffix `#web`, inline `#web`, `[web]`, or phrases). */
export function tripUserMessageRequestsWebSearch(text: string): boolean {
  return (
    tripUserMessageContainsHashWeb(text) ||
    tripBracketOrPhraseRequestsWeb(text)
  );
}

export function replaceLastUserContent(
  turns: { role: "user" | "assistant"; content: string }[],
  newContent: string
): { role: "user" | "assistant"; content: string }[] {
  let lastUser = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return turns;
  const content =
    newContent.trim().length > 0
      ? newContent.trim()
      : "Please search the web for details relevant to this trip.";
  return turns.map((m, i) => (i === lastUser ? { ...m, content } : m));
}

/** Last user message with trailing `#web` removed for the search query. */
export function replaceLastUserStripTrailingHashWeb(
  turns: { role: "user" | "assistant"; content: string }[]
): { role: "user" | "assistant"; content: string }[] {
  let lastUser = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return turns;
  const stripped = stripTrailingHashWebMarker(turns[lastUser].content);
  const content =
    stripped.length > 0
      ? stripped
      : "Please search the web for details relevant to this trip.";
  return turns.map((m, i) => (i === lastUser ? { ...m, content } : m));
}

/** Apply {@link stripTripWebSearchMarkers} to the last user message. */
export function normalizeTripAssistantTurnsForWebTool(
  turns: { role: "user" | "assistant"; content: string }[],
  stripMarkers: boolean
): { role: "user" | "assistant"; content: string }[] {
  if (!stripMarkers || turns.length === 0) return turns;
  let lastUser = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return turns;
  return turns.map((m, i) => {
    if (i !== lastUser) return m;
    const stripped = stripTripWebSearchMarkers(m.content);
    const content = stripped.length > 0 ? stripped : m.content.trim();
    return {
      ...m,
      content:
        content.length > 0
          ? content
          : "Please search the web for helpful details relevant to this trip.",
    };
  });
}
