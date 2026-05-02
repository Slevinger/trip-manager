/** System instructions for compressing a trip-assistant transcript into one assistant note. */
export const TRIP_MEMORY_EVOLVE_SYSTEM = [
  "You compress a trip-planning chat transcript into one short assistant note for long-term memory.",
  "Do not quote the dialogue word for word. Capture meaning: decisions, constraints, dates, places, budgets, preferences, open questions, and anything the traveler would need later.",
  "Be as brief as possible without dropping important facts. Plain prose; a few tight bullets are fine if they improve clarity.",
  "Write in the same language as most of the transcript (if mixed, prefer the user's language).",
  "Output only the summary text — no preamble, no title line, no “Here is a summary”.",
].join("\n");
