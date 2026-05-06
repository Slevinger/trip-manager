/**
 * Classification of a trip-assistant user message:
 * - `general`     → about the user themself (likes, hobbies, lifestyle, future trips,
 *                  cross-trip preferences). Worth attaching `__global__` context.
 * - `specific`    → about the current trip (a step, booking, place, time, budget).
 *                  `__global__` context is unhelpful and just costs tokens.
 * - `suggestions` → user explicitly asks for actionable proposals to add to the trip.
 *                  The assistant must emit a fenced `trip-suggestions` JSON block in
 *                  addition to the conversational reply (see
 *                  {@link buildTripRecommendationSchemaPrompt}).
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
 * The system-prompt fragment instructing the assistant to append a classification
 * marker on the very last line. Kept here so prompt + parser stay in sync.
 */
export const TRIP_ASSISTANT_REQUEST_KIND_INSTRUCTION = [
  "",
  "### Classify your reply",
  `End your reply with EXACTLY one classification marker on its own final line, with no extra punctuation, prefix, or trailing text:`,
  `- ${REQUEST_KIND_GENERAL_MARKER}     → use when the user's latest message is about THEM as a traveler (likes, dislikes, hobbies, music, food preferences, lifestyle, pace, budget style, future trips, or cross-trip questions).`,
  `- ${REQUEST_KIND_SPECIFIC_MARKER}    → use when the user's latest message is about THIS trip's concrete details (a step, place, date, booking, route, price, schedule, document).`,
  `- ${REQUEST_KIND_SUGGESTIONS_MARKER} → use when the user explicitly asks you to PROPOSE additions to the trip queue (stays, transit, or activities they should consider). When you pick this marker you MUST also include the fenced \`trip-suggestions\` JSON block described above; bind places to existing \`trip.destinations[].id\` values whenever they match (do not invent parallel ids). For activity options tied to a stay in \`trip.steps\`, set \`hostStayStepId\` to that stay step's \`id\`. If you cannot, choose \`${REQUEST_KIND_SPECIFIC_MARKER}\` or \`${REQUEST_KIND_GENERAL_MARKER}\` instead.`,
  "If both apply, pick the dominant intent. Never omit the marker. Never invent other markers.",
].join("\n");
