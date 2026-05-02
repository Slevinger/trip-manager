import type { Trip, TripStep } from "@/lib/types/trip";
import type { ChatMemoryTripWhere } from "@/lib/types/user";
import { getTripViewPhase, resolveCurrentStepForDashboard } from "@/lib/tripViewPhase";

function destTitle(trip: Trip, id: string | undefined): string | undefined {
  if (!id?.trim()) return undefined;
  const d = trip.destinations.find((x) => x.id === id);
  const t = d?.title?.trim();
  return t || undefined;
}

function stepById(trip: Trip, id: string | undefined): TripStep | undefined {
  if (!id?.trim()) return undefined;
  return trip.steps.find((s) => s.id === id);
}

function focusLabel(kind: "active" | "upcoming" | "none"): string {
  if (kind === "active") return "In this step now";
  if (kind === "upcoming") return "Next on itinerary";
  return "No step";
}

/**
 * Snapshot of where the traveler was on the itinerary when a chat turn happened
 * (same “current step” idea as the trip dashboard).
 */
export function buildChatMemoryTripWhere(trip: Trip, nowMs: number): ChatMemoryTripWhere {
  const tripPhase = getTripViewPhase(trip, nowMs);
  const focus = resolveCurrentStepForDashboard(trip, nowMs);
  const tripTitle = trip.title?.trim() || "Trip";

  if (focus.kind === "none") {
    return {
      tripId: trip.id,
      tripTitle,
      tripPhase,
      stepFocus: "none",
      summary: `${tripTitle} · ${tripPhase.replace("_", " ")} · no steps on the trip yet`,
    };
  }

  const step = focus.step;
  const stepFocus = focus.kind === "active" ? "active" : "upcoming";
  let placeTitle: string | undefined;
  let intervalFlavor: string | undefined;

  if (step.stepType === "stay") {
    placeTitle = destTitle(trip, step.targetDestinationId);
    intervalFlavor = step.stepIntervals[0]?.stayType;
  } else if (step.stepType === "activity") {
    placeTitle = destTitle(trip, step.destinationId) ?? destTitle(trip, step.targetDestinationId);
    intervalFlavor = step.stepIntervals[0]?.activityType;
  } else {
    placeTitle = destTitle(trip, step.targetDestinationId);
    const fromS = stepById(trip, step.fromStayId);
    const toS = stepById(trip, step.toStayId);
    const a = fromS?.title?.trim();
    const b = toS?.title?.trim();
    intervalFlavor = "transit";
    if (a && b) placeTitle = `${a} → ${b}`;
    else if (a || b) placeTitle = a ?? b;
  }

  const kindBit = intervalFlavor ? `${step.stepType} (${intervalFlavor})` : step.stepType;
  const placeBit = placeTitle ? ` @ ${placeTitle}` : "";
  const summary = `${tripTitle} · ${tripPhase.replace("_", " ")} · ${focusLabel(stepFocus)}: "${step.title}"${placeBit} · ${kindBit}`;

  return {
    tripId: trip.id,
    tripTitle,
    tripPhase,
    stepFocus,
    stepId: step.id,
    stepTitle: step.title,
    stepType: step.stepType,
    intervalFlavor,
    placeTitle,
    summary: summary.slice(0, 500),
  };
}
