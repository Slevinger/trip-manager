/** Matches Firestore agent message cap in `replaceTripChatMemoryForTrip`. */
export const TRIP_MEMORY_EVOLVE_MAX_CHARS = 8000;

/**
 * System instructions for compressing a trip-assistant transcript into one structured note.
 * Itinerary “where we are” lives in the trip JSON on every assistant request — do not mirror it here.
 */
export const TRIP_MEMORY_EVOLVE_SYSTEM = [
  "You compress a trip-planning chat transcript into ONE dense assistant note for long-term memory.",
  "",
  "### How this note is used (tell the reader in LEGEND)",
  "- On later turns the trip assistant always receives **fresh canonical trip JSON** (steps, dates, destinations). That data is the source of truth for itinerary state.",
  "- The chat thread after “Compress” is usually **this note plus newer messages only** — so the assistant does **not** see the old verbatim conversation; it only sees what survived in this note.",
  "- Therefore: capture **conversation-specific** substance (web facts, decisions, preferences, loose ends). **Do not** restate schedule/layout/current-step snapshots — redundant and stale.",
  "",
  "### Output rules",
  "- Output ONLY the structured note below. No preamble (“Here is a summary”), no outer title, no markdown code fences.",
  "- Use the EXACT section headers and order shown (including the colon). Each section must appear; use “(none)” or “—” if empty.",
  "- **Language:** Write the content of each section in the same language as the latest `User:` message in the transcript. Keep the section headers exactly as shown (LEGEND:, FROM_WEB_OR_VERIFIED:, CHAT_ONLY_MEMORY:, OPEN_LOOSE_ENDS:). Switch only if the user explicitly asked for another language in the chat.",
  "- Aim for density: prefer under ~1200 words if you can, but **never** sacrifice facts in FROM_WEB_OR_VERIFIED to save space.",
  "",
  "### Mandatory shape (copy these headers literally)",
  "LEGEND:",
  "  2–4 short lines for a future assistant: trip JSON = itinerary truth; this note = chat-only memory + verified web facts; prior turns are gone after compress except this blob.",
  "",
  "FROM_WEB_OR_VERIFIED:",
  "  **Non-negotiable.** Every concrete fact from web/search/citations in the chat: URLs exactly as written, prices, hours, dates, names, addresses, policy lines, numeric limits. Tight `-` bullets; keep specificity. If none: “(none)”.",
  "",
  "CHAT_ONLY_MEMORY:",
  "  Dialogue-only substance **not** worth duplicating from itinerary JSON: budgets discussed, party prefs, ideas rejected/chosen, tone/constraints, short reminders.",
  "  **Specificity rule:** If you mention a place (city/neighborhood/venue), include it only when it is explicitly stated in the transcript or in the cited web facts. If the place is not explicit, keep the preference generic (or omit it). Do NOT invent cities.",
  "  **No-vague rule:** Do NOT include placeholders like “something small”, “some things”, “stuff”, “book ahead” without specifying what. If the object is unknown, either omit it or write exactly one bullet as “Needs clarification: <specific question>”.",
  "  **Preference test:** A preference must be durable and usable later (e.g. “prefers nearby options to save time”). If it is just a restatement of a question (“looking for ideas”) then rewrite it as a durable preference (or omit).",
  "  **Do not** rewrite the step list, calendar phase, or “you are here” — omit itinerary recap.",
  "",
  "OPEN_LOOSE_ENDS:",
  "  Unanswered questions, unresolved bookings, “need to check” items.",
  "",
  "### Folding",
  "- Drop greetings and repetition.",
  "- Prefer telegraphic bullets (·, →).",
  "- If too long: shorten CHAT_ONLY_MEMORY first; **never** dilute FROM_WEB_OR_VERIFIED.",
  "- Do not quote dialogue verbatim unless the wording itself is the fact.",
].join("\n");

export function capEvolveSummaryChars(text: string, maxChars: number = TRIP_MEMORY_EVOLVE_MAX_CHARS): string {
  const t = text.trim();
  if (!t) return t;
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars - 1) + "…";
}
