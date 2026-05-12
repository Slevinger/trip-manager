import { sortTripStepsByStartTime } from "@/lib/tripStepSort";
import { TRIP_ASSISTANT_REQUEST_KIND_INSTRUCTION } from "@/lib/tripAssistantRequestKind";
import { buildTripRecommendationSchemaPrompt } from "@/lib/tripAssistantSuggestionSchema";
import type { Trip, TripStep, UserPreferences } from "@/lib/types/trip";
import { getTripViewPhase, resolveCurrentStepForDashboard } from "@/lib/tripViewPhase";

/** Minimal internal hop: normalize inline web markers -> one search line (no tools). */
export const TRIP_ASSISTANT_WEB_REFINE_APPENDIX =
  "\n\nINTERNAL: Latest user turn has one of these markers not at EOL: `=>`, `>=`, `<=`, `=<`. Output **only** one English search-query line (trip JSON + chat facts; keywords/places/dates; no pleasantries). Must end with ` =>`.";

function stepHeadline(step: TripStep): string {
  const t = step.title?.trim() || "Untitled step";
  const range = `${step.startTime}${step.endTime ? ` → ${step.endTime}` : ""}`;
  return `${t} (${step.stepType}) · ${range}`;
}

/**
 * System instructions + structured trip context for the trip assistant.
 * Keeps preferences as soft inspiration; emphasizes “now” on the itinerary.
 */
export function buildTripAssistantSystemPrompt(
  trip: Trip,
  opts: {
    nowMs: number;
    /** Signed-in user’s profile prefs — optional, phrased softly for the model. */
    profilePreferences?: UserPreferences | null;
    /** Trip-assistant Anthropic branch only: `web_search` tool is attached this request. */
    anthropicWebSearchEnabled?: boolean;
    /** Optional traveler GPS context (synced + optional fresh ping). */
    travelerLocationContextAppendix?: string;
  }
): string {
  const phase = getTripViewPhase(trip, opts.nowMs);
  const focus = resolveCurrentStepForDashboard(trip, opts.nowMs);
  const sorted = sortTripStepsByStartTime(trip.steps);

  let currentEmphasis = "";
  if (focus.kind === "none") {
    currentEmphasis =
      "There are no steps on this trip yet — help brainstorm structure, pacing, or first steps if asked.";
  } else {
    const s = focus.step;
    const label = focus.kind === "active" ? "IN FOCUS NOW (active window)" : "NEXT UP (upcoming)";
    currentEmphasis = `${label}:\n- ${stepHeadline(s)}\n- Notes: ${(s.notes?.length ? s.notes.join(" · ") : "(none)")}`;
  }

  const prefs = opts.profilePreferences;
  const prefsBlock =
    prefs &&
    (prefs.hobbies.length > 0 || prefs.activities.length > 0 || prefs.lifestyle.length > 0)
      ? [
          "",
          "### Optional vibe tags (not requirements)",
          "The traveler keeps loose lists for inspiration only — not rules, not a checklist, not medical or legal advice. Treat as creative texture; ignore if irrelevant.",
          `- Hobbies (ideas, not obligations): ${prefs.hobbies.join(", ") || "—"}`,
          `- Activity flavours they enjoy (not bookings): ${prefs.activities.join(", ") || "—"}`,
          `- Lifestyle notes (soft context): ${prefs.lifestyle.join(", ") || "—"}`,
        ].join("\n")
      : "";

  const webContextLines = opts.anthropicWebSearchEnabled
    ? [
        "Web: `web_search` is on — **never** claim no internet, hard limits, or ‘hashtags don’t enable search’. Fire **one** tight query (no redundant searches). Answer fully from trip JSON + results with **complete sentences** (no trailing cutoff mid‑clause); optional domain/title from citations; no invented URLs; no preamble/refusal/homework.",
      ]
    : [
        "No live web — trip JSON + chat only; don’t claim you browsed.",
        "No ‘can’t search’ lines or homework lists; optional soft hints when helpful.",
      ];

  const tripJson = JSON.stringify(
    {
      id: trip.id,
      title: trip.title,
      description: trip.description,
      currency: trip.currency,
      budget: trip.budget,
      startDate: trip.startDate,
      endDate: trip.endDate,
      destinations: trip.destinations,
      travelers: trip.travelers,
      viewers: trip.viewers ?? [],
      liveLocations: trip.liveLocations ?? {},
      steps: sorted,
      tasks: trip.tasks ?? [],
      documents: trip.documents ?? [],
    },
    null,
    2
  );

  return [
    "You are a professional travel agent: calm, precise, and trustworthy.",
    "**Language:** Reply in the **same language as the user’s latest message** by default. Only switch languages when the user explicitly asks you to. Keep proper nouns and place names as they appear in the trip data when helpful.",
    "**Formatting:** Use normal Markdown when helpful: put **each list item on its own line** starting with `- ` (blank line before a list if it follows a paragraph). Never cram multiple `-` items into one run-on line.",
    "Finish every reply with proper sentence endings (period / question mark); do not stop mid‑sentence.",
    "When `liveLocations` in the trip JSON is non-empty, those are voluntary last-known device coordinates for participants (not continuous surveillance). Use them for nearby suggestions or “where is everyone” style questions.",
    "Be accurate to the trip data below; if something is unknown, say so briefly and suggest a next step.",
    "**Thread vs trip JSON:** Older messages may have been merged into one long assistant note. Use that note for prior web facts and chat-only context. For itinerary layout, steps, and dates, treat the trip JSON below as source of truth (the note must not be relied on for current schedule state).",
    "**NEVER copy the format of memory notes.** Any assistant turn that begins with `[TRIP_MEMORY_NOTE`, `[GLOBAL_MEMORY_NOTE`, or contains headers like `LEGEND:`, `FROM_WEB_OR_VERIFIED:`, `CHAT_ONLY_MEMORY:`, `OPEN_LOOSE_ENDS:` is a compressed memory dump for your context only. Read it silently. Your reply must be a normal conversational answer (prose + optional bullet list) and **must not** contain any of those headers or that structured layout.",
    "Web marker syntax (`=>`, `>=`, `<=`, `=<`): suffix marker -> server searches text before it (Anthropic). Inline marker -> server emits one query line ending `=>` then searches.",
    ...webContextLines,
    "You do not book tickets or hotels. Facts: trip JSON + chat + (if web) search blocks — quote links only from results.",
    opts.anthropicWebSearchEnabled
      ? "Skip disclaimers and manner filler (“happy to help”, etc.)."
      : "No nagging disclaimers or ‘open Google Maps / TripAdvisor’; one neutral clause max if essential.",
    "Help with budget, pacing, packing, itinerary — no medical/legal guarantees.",
    ...(opts.anthropicWebSearchEnabled
      ? []
      : ["When maps/prices help without web: brief optional hints, not commands."]),
    "",
    `### Trip calendar phase (from server clock): **${phase}**`,
    currentEmphasis,
    "",
    "### Full trip payload (source of truth)",
    "Use this JSON for structure, ids, and times. If something is missing, say so briefly.",
    "```json",
    tripJson,
    "```",
    "",
    "### Destination ids (use these in suggestions)",
    "Every place on this trip is listed under `destinations` above; each row’s `id` is the canonical key.",
    "When you reply with `##suggestions##` and the fenced `trip-suggestions` JSON, set `destinationId`, `fromDestinationId`, and `toDestinationId` on intervals to **those exact id strings** whenever the proposal refers to an existing row.",
    "For **activity** suggestions, also set each option’s `hostStayStepId` to the **`trip.steps` stay step `id`** when the activity belongs while the traveler is based at that stay.",
    "Do **not** mint a second id or duplicate that place inside `option.destinations` — reserve `option.destinations` only for places that are **not** already in `trip.destinations`.",
    prefsBlock,
    "",
    buildTripRecommendationSchemaPrompt(),
    TRIP_ASSISTANT_REQUEST_KIND_INSTRUCTION,
    ...(opts.travelerLocationContextAppendix?.trim()
      ? [opts.travelerLocationContextAppendix.trim()]
      : []),
  ].join("\n");
}
