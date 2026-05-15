/**
 * Normalizes model output where multiple list items are glued with ` - ` on one line.
 * Markdown lists need leading newlines before `- ` so ReactMarkdown + GFM renders bullets.
 */
export function formatAssistantReplyForMarkdown(raw: string): string {
  // Strip Anthropic web-search citation tags — two-pass so long/multi-line content is handled.
  // Pass 1: paired open+close (keeps inner text).
  // Pass 2: any orphaned opening or closing tags that slipped through.
  let t = raw
    .replace(/<cite[^>]*>([\s\S]*?)<\/cite>/gi, "$1")
    .replace(/<\/?cite[^>]*>/gi, "")
    // Strip "View on Site ·" attribution lines emitted by web-search results
    .replace(/^View on .+ ·\s*$/gim, "")
    .replace(/\r\n/g, "\n").trim();
  if (!t) return t;

  // "Heading: - First bullet …" → heading then real list
  t = t.replace(/:\s*-\s+/g, ":\n\n- ");

  /** Split before URLs, Site.com, or "Label:" style starters (e.g. KAYAK:, Booking.com:). */
  const inlineDashSplit =
    /\s+-\s+(?=(?:https?:\/\/|[A-Z][a-zA-Z0-9.-]{2,48}:\s|[A-Z][a-zA-Z0-9.-]*\.(?:com|net|org)\b(?:\/|$|[?:\s])))/g;

  let prev = "";
  for (let i = 0; i < 10 && prev !== t; i++) {
    prev = t;
    t = t.replace(inlineDashSplit, "\n- ");
  }

  return t.replace(/\n{3,}/g, "\n\n").trim();
}
