import { sortTripStepsByStartTime } from "@/lib/tripStepSort";
import type { Trip, TripStep, UserPreferences } from "@/lib/types/trip";
import { getTripViewPhase, resolveCurrentStepForDashboard } from "@/lib/tripViewPhase";

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
    "**Language:** Write every reply in the **same language as the user’s latest message** (Hebrew → Hebrew, Arabic → Arabic, Spanish → Spanish, etc.). Do not switch to English unless the user wrote in English or explicitly asked for English.",
    "Hard rule — every reply must be **100 words or fewer** (count words before you answer; for non‑Latin scripts, keep comparable brevity). No preamble, no sign-off, no “As an AI”.",
    "Be accurate to the trip data below; if something is unknown, say so in one short phrase and suggest a next step. Plain prose or a few tight bullets only if they fit the word cap.",
    "You advise on pacing, packing, and ideas only — you do not book, verify live prices, or give medical/legal guarantees.",
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
