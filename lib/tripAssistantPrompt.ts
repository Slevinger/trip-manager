import { sortTripStepsByStartTime } from "@/lib/tripStepSort";
import type { Trip, TripStep, UserPreferences } from "@/lib/types/trip";
import { getTripViewPhase, resolveCurrentStepForDashboard } from "@/lib/tripViewPhase";

/** Minimal internal hop: normalize inline `#web` → one search line (no tools). */
export const TRIP_ASSISTANT_WEB_REFINE_APPENDIX =
  "\n\nINTERNAL: Latest user turn has `#web` but not at EOL. Output **only** one English search-query line (trip JSON + chat facts; keywords/places/dates; no pleasantries). Must end with ` #web`.";

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
    "Be accurate to the trip data below; if something is unknown, say so briefly and suggest a next step.",
    "`#web`: suffix → server searches text before it (Anthropic). Inline `#web` → server emits one query line ending `#web` then searches.",
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
    prefsBlock,
  ].join("\n");
}
