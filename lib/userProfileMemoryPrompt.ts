/**
 * Extra system override appended to the global profile evolve prompt
 * once the same global summary has been evolved 2+ times.
 * After the second pass we drop trip-bound transient data and keep only
 * durable user characteristics that help any future trip.
 */
export const USER_PROFILE_MEMORY_EVOLVE_DURABLE_OVERRIDE = [
  "",
  "### Durable-only mode (this content has already been evolved 2+ times)",
  "- IGNORE and OMIT every date, day, month, year, season, deadline, and any \"by <date>\" item.",
  "- IGNORE and OMIT every price, currency, fee, deposit, refund, discount, and budget number.",
  "- IGNORE and OMIT every reservation, booking, confirmation code, ticket, voucher, and address.",
  "- IGNORE and OMIT every URL and trip-specific search result.",
  "- IGNORE and OMIT all one-trip itinerary details (steps, times, durations, transit legs).",
  "- KEEP ONLY durable, cross-trip user characteristics: likes, dislikes, hobbies, music genres,",
  "  food preferences and restrictions, pace and budget style, travel companions style,",
  "  accessibility needs, language preferences, recurring activities, brand/app preferences.",
  "- If a section has no durable content after this filter, write `(none)` under it.",
  "- The output MUST be at most 1500 characters; tighten or merge bullets to fit.",
].join("\n");

/** System instructions for compressing global user profile memory (trip-agnostic). */
export const USER_PROFILE_MEMORY_EVOLVE_SYSTEM = [
  "You compress chat turns into ONE short durable user-profile note for a travel assistant.",
  "The note must be trip-agnostic: it should remain useful across future trips.",
  "",
  "### Output rules",
  "- Output ONLY the note; no preamble.",
  "- Keep these headers exactly (in English): LEGEND:, FAVORITES:, DISLIKES:, PREFERENCES:, IMPORTANT_FACTS:, OPEN_TOPICS:.",
  "- Write the content under each header in the same language as the latest `User:` message in the input.",
  "- Be precise and stable: keep only durable traits (food likes/dislikes, pace, budget style, activities, constraints, accessibility, recurring interests).",
  "- **Specificity rule:** If you mention a place (city/country/venue), only include it when it is explicitly stated by the user. Otherwise keep it generic. Do NOT invent cities.",
  "- **No-vague rule:** Do NOT store placeholders like “something small”, “maybe”, “book ahead” without specifying what. If unclear, omit it or add ONE bullet under OPEN_TOPICS as a concrete question to clarify.",
  "- **Durability rule:** Only store info that will matter across future trips. If it only applies to one trip/day, omit it.",
  "- Do not include one-off itinerary details (dates, step times, costs) unless it is a lasting preference.",
  "",
  "LEGEND:",
  "  1–3 lines: this is global user memory for future trips.",
  "",
  "FAVORITES:",
  "  `-` bullets only. Food, activities, destinations styles, etc.",
  "",
  "DISLIKES:",
  "  `-` bullets only. Things to avoid.",
  "",
  "PREFERENCES:",
  "  `-` bullets only. Budget/pacing/logistics preferences, travel style.",
  "",
  "IMPORTANT_FACTS:",
  "  `-` bullets only. Durable constraints or personal requirements mentioned (no medical/legal claims).",
  "",
  "OPEN_TOPICS:",
  "  `-` bullets only. Ongoing interests to ask about next time.",
].join("\\n");

