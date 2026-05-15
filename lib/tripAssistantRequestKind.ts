/**
 * Classification of a trip-assistant user message:
 * - `general`     → about the user themself (likes, hobbies, lifestyle, future trips,
 *                  cross-trip preferences). Worth attaching `__global__` context.
 * - `specific`    → about the current trip (a step, booking, place, time, budget).
 *                  `__global__` context is unhelpful and just costs tokens.
 * - `suggestions` → user explicitly asks for actionable proposals to add to the trip.
 *                  The assistant must emit a fenced `trip-suggestions` JSON block in
 *                  addition to the conversational reply. The **array** inside the
 *                  \`trip-suggestions\` fence is what the app iterates for approve/skip;
 *                  keep free-form prose minimal when using this marker.
 */
export type TripAssistantRequestKind = "general" | "specific" | "suggestions";

export const REQUEST_KIND_GENERAL_MARKER = "##general##";
export const REQUEST_KIND_SPECIFIC_MARKER = "##specific##";
export const REQUEST_KIND_SUGGESTIONS_MARKER = "##suggestions##";

/** Any marker, optionally surrounded by whitespace, on the LAST non-empty line. */
const TRAILING_MARKER_RE = /\s*##(general|specific|suggestions)##\s*$/i;

/**
 * Parses the trailing classification marker the assistant is instructed to emit.
 * Returns `null` when no marker is present.
 */
export function parseTripAssistantRequestKind(replyText: string): TripAssistantRequestKind | null {
  if (!replyText) return null;
  const m = TRAILING_MARKER_RE.exec(replyText);
  if (!m) return null;
  const v = m[1].toLowerCase();
  if (v === "general" || v === "specific" || v === "suggestions") {
    return v as TripAssistantRequestKind;
  }
  return null;
}

/**
 * Removes the trailing classification marker (and the whitespace before it) from a reply.
 * Useful when the marker should drive logic but not pollute logs / summaries.
 */
export function stripTripAssistantRequestKindMarker(replyText: string): string {
  if (!replyText) return replyText;
  return replyText.replace(TRAILING_MARKER_RE, "").trimEnd();
}

/**
 * Heuristic: should the next assistant call include `__global__` cross-trip memory?
 *
 * Cheap, deterministic, runs on the client before each send. Picks "general" when the
 * latest user message reads like a personal-preferences / cross-trip question, OR when
 * the most recent assistant reply self-classified as `##general##`. Defaults to specific.
 */
export function tripAssistantNeedsGlobalContext(
  latestUserText: string,
  priorAssistantReply?: string | null
): boolean {
  const t = (latestUserText ?? "").trim();
  if (!t) return false;

  // 1) Hard signal: prior reply self-classified as general (multi-turn personal thread).
  if (priorAssistantReply) {
    const k = parseTripAssistantRequestKind(priorAssistantReply);
    if (k === "general") return true;
    if (k === "specific") {
      // A prior specific turn doesn't *block* general detection; fall through to keywords.
    }
  }

  const lower = t.toLowerCase();

  // 2) Strong personal-preference / cross-trip cues (English + Hebrew).
  const generalCues: RegExp[] = [
    /\bi (like|love|hate|prefer|usually|always|never|enjoy|avoid)\b/,
    /\bmy (taste|favou?rite|preference|style|hobby|hobbies|vibe|pace)\b/,
    /\bin general\b|\bgenerally\b|\bfor me\b|\babout me\b|\byou know me\b|\bremember (me|that)\b/,
    /\b(next|future) trip\b|\bfor my next\b/,
    /\bwhat (do you|would you) recommend (for|to) me\b/,
    /\b(based on (what you know about )?me|knowing me)\b/,
    // "Where should I travel/go next?" style questions (no specific destination yet).
    /\bwhere (should|do you recommend|would you recommend|to) (i|we) (go|travel|fly)\b/,
    /\b(where|what (place|country|city|destination)) .*(travel|visit|go).*\bnext\b/,
    /\b(recommend|suggest) (me|us)?\s*(a|some)?\s*(trip|destination|place|country|city)\b/,
    // Hebrew personal preference cues.
    /אני (אוהב|אוהבת|שונא|שונאת|מעדיף|מעדיפה|נהנה|נהנית)/,
    /טעם שלי|העדפ(ות|ה) שלי|סגנון שלי|תחביב/,
    /באופן כללי|בכלל|בדרך כלל|תזכור|מכיר אותי|זוכר אותי/,
    /טיול הבא|לטיול הבא|הטיול הבא/,
    // Hebrew "where should I travel/fly/go next" — verb forms with "הלאה" / "אחרי זה" / "בעתיד".
    /לאן (כדאי|אני|תמליץ|להמליץ|להציע|כדאי לי|נוסעים|לטוס|לטייל|ללכת|ניסע|נטוס|נטייל)/,
    /(לטייל|לטוס|לנסוע|ללכת)\s+(הלאה|אחרי זה|בהמשך|בעתיד|הבא)/,
    /\b(טיול|יעד|מקום|מדינה|עיר)\s+(הבא|הלאה|לעתיד|חדש)\b/,
  ];
  for (const re of generalCues) if (re.test(lower)) return true;

  // 3) Default: specific. Trip-detail questions don't benefit from global noise.
  return false;
}

/**
 * Client boost when classify returns `specific` (or fails) but the text clearly asks for
 * structured trip additions — server then appends {@link TRIP_ASSISTANT_CLASSIFIED_SUGGESTIONS_APPENDIX}.
 */
export function tripAssistantUserWantsStructuredTripProposals(latestUserText: string): boolean {
  const t = (latestUserText ?? "").trim();
  if (!t) return false;
  const lower = t.toLowerCase();

  const proposal =
    /\b(suggest(ions?)?|recommend(ations?)?|propose|brainstorm|give me (a |some |few )?(options|ideas)|any (good )?ideas\b|what (should|can) (i|we) (add|book|try|visit|see))\b/i.test(
      lower
    ) ||
    /תמליץ|תציע|המלצות|מה (להוסיף|כדאי לי|אפשר)|תן (לי )?(כמה )?רעיונות/i.test(t);

  if (!proposal) return false;

  const crossTripOnly =
    /\b(next|future) (trip|vacation|holiday)\b/.test(lower) ||
    /\bwhere (should|do you recommend|would you recommend|to) (i|we) (go|travel|fly)\b/.test(
      lower
    ) ||
    /\b(recommend|suggest) (me|us)?\s*(a|some)?\s*(trip|destination|place|country|city)\b(?:\s*[.?!])?\s*$/i.test(
      lower
    ) ||
    /טיול הבא|לטיול הבא|לאן (כדאי|לי).*לטוס|לאן לטייל/.test(t);

  const tripAnchored =
    /\b(this|my|our|the) (trip|itinerary)\b/.test(lower) ||
    /\b(day|night) \d+\b/i.test(lower) ||
    /\b(hotel|hostel|stay|lodging|resort|airbnb|flight|train|bus|shuttle|transit|ferry|museum|restaurant|dinner|lunch|breakfast|activity|tour|excursion|booking|step|itinerary|leg)\b/.test(
      lower
    ) ||
    /\b(today|tomorrow|tonight|weekend)\b/.test(lower) ||
    /שלב|מלון|טיסה|רכבת|מסעדה|מוזיאון|פעילות|סיור|הזמנה|היום|מחר|בערב/.test(t);

  if (!tripAnchored) return false;
  if (crossTripOnly) return false;

  return true;
}

/**
 * Appended to the system prompt when the client marks this turn as proposal-shaped so the
 * model emits `##suggestions##` plus a fenced `trip-suggestions` JSON block.
 *
 * Two-path logic:
 *  - If the request lacks enough specificity, ask ONE clarifying question (##specific##, no fence).
 *  - If context is sufficient, emit ONE sentence of prose + the fence + ##suggestions##.
 */
export const TRIP_ASSISTANT_CLASSIFIED_SUGGESTIONS_APPENDIX = [
  "",
  "### Server classification (this turn)",
  "The user's latest message was classified as a request for **concrete trip additions** (stays, transit, or activities to consider adding to this trip).",
  "",
  "**Clarify-first gate (evaluate BEFORE generating suggestions):**",
  "Check whether the conversation already tells you: (1) which day or time slot, (2) what kind of addition (stay / transit / activity), and (3) any price or style constraint.",
  "If ANY of these is genuinely unknown and NOT answered earlier in this conversation, ask EXACTLY ONE focused clarifying question as your entire visible reply (one sentence), end with `##specific##`, and do NOT emit a `trip-suggestions` fence.",
  "If you have enough context to generate good options, proceed with the instructions below.",
  "",
  "**When proceeding with suggestions:**",
  "Your visible reply MUST be exactly ONE sentence (no lists, no headers, no tables in prose) followed by the `trip-suggestions` fence.",
  "The product **queues only** the JSON **array** inside the single fenced `trip-suggestions` code block. Put **all** comparable alternatives there — do NOT repeat options as markdown text.",
  "Each `TripRecommendation` in the array MUST have **at least 3 distinct `options`**. If you cannot produce 3 genuine alternatives for a slot, omit that recommendation entirely.",
  `You MUST end with exactly ${REQUEST_KIND_SUGGESTIONS_MARKER} as the final line.`,
  "Ground options in the current trip dates and existing `trip.destinations` ids. Do **not** choose `##general##` for hotel/resort/activity/transit ideas the user could add to this itinerary.",
  "",
  "**Research source — ALWAYS use Tripadvisor first:**",
  "Search Tripadvisor for every hotel, restaurant, and activity you suggest. Base the option's `note`, ratings, and highlights on what you find on Tripadvisor.",
  "",
  "**Links — provide BOTH for every option:**",
  "• `url` (review/ratings): Tripadvisor search link — https://www.tripadvisor.com/Search?q={Hotel+Name+City}",
  "• `bookingUrl` (check availability): Booking.com search with trip dates — https://www.booking.com/searchresults.html?ss={Hotel+Name+City}&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&group_adults=N&no_rooms=1",
  "  For activities: use Viator search or the operator's direct booking page. For flights: Google Flights URL.",
  "",
  "**Images — REQUIRED for every option:**",
  "For each hotel/venue, visit its Tripadvisor listing page (search Tripadvisor, click the result). The page HTML contains a `<meta property=\"og:image\" content=\"...\">` tag with a direct CDN image URL (e.g. https://dynamic-media-cdn.tripadvisor.com/media/photo-o/2c/ab/34/84/caption.jpg?w=900&h=500&s=1).",
  "Copy that exact CDN URL into `imageUrl`. The URL path must contain a real image extension (.jpg, .jpeg, .webp, .png) — query parameters like `?w=900&h=500&s=1` are fine and should be kept as-is.",
  "Never put a homepage URL. Always put the direct image file URL from Tripadvisor's og:image.",
].join("\n");

/**
 * Appended to the system prompt for a second-pass retry when the first response
 * produced suggestions with fewer than 3 options each.
 */
export const EXPAND_OPTIONS_RETRY_APPENDIX = [
  "",
  "### Retry: minimum options not met",
  "The previous response had at least one recommendation with fewer than 3 options.",
  "Output ONLY a `trip-suggestions` fence — no chat prose, no classification marker explanation.",
  "Every `TripRecommendation` in the array MUST have EXACTLY 3 or more distinct `options`.",
  `End with ${REQUEST_KIND_SUGGESTIONS_MARKER}.`,
].join("\n");

/**
 * The system-prompt fragment instructing the assistant to append a classification
 * marker on the very last line. Kept here so prompt + parser stay in sync.
 */
export const TRIP_ASSISTANT_REQUEST_KIND_INSTRUCTION = [
  "",
  "### Classify your reply",
  `End your reply with EXACTLY one classification marker on its own final line, with no extra punctuation, prefix, or trailing text:`,
  `- ${REQUEST_KIND_GENERAL_MARKER}     → use when the user's latest message is about THEM as a traveler (likes, dislikes, hobbies, music, food preferences, lifestyle, pace, budget style, future trips, or cross-trip questions).`,
  `- ${REQUEST_KIND_SPECIFIC_MARKER}    → use when the user's latest message is about THIS trip's concrete details (a step, place, date, booking, route, price, schedule, document).`,
  `- ${REQUEST_KIND_SUGGESTIONS_MARKER} → use when the user explicitly asks you to PROPOSE additions to the trip queue (stays, transit, or activities they should consider). When you pick this marker you MUST include the fenced \`trip-suggestions\` JSON block described above — a **top-level JSON array** \`[...]\` of \`TripRecommendation\` objects that the app will iterate; keep normal chat prose **short** and do **not** mirror the same alternatives again as markdown lists/tables/articles. Bind places to existing \`trip.destinations[].id\` values whenever they match (do not invent parallel ids). For activity options tied to a stay in \`trip.steps\`, set \`hostStayStepId\` to that stay step's \`id\`. If you cannot, choose \`${REQUEST_KIND_SPECIFIC_MARKER}\` or \`${REQUEST_KIND_GENERAL_MARKER}\` instead.`,
  "If both apply, pick the dominant intent. Never omit the marker. Never invent other markers.",
].join("\n");
