import type {
  ActivityStep,
  ActivityStepInterval,
  StayStep,
  TransitStep,
  TransitStepInterval,
  Trip,
} from "@/lib/types/trip";

export type MapDestinationPinCategory = "hotel" | "transit" | "stayArea" | "activity" | "place";

function isStayHotelDestinationId(trip: Trip, id: string): boolean {
  for (const step of trip.steps) {
    if (step.stepType !== "stay") continue;
    const s = step as StayStep;
    /** Explicit lodging pin on a stay segment (resort, hotel, …). */
    for (const int of s.stepIntervals) {
      if (int.intervalType !== "stay") continue;
      const si = int as StayStepInterval;
      if (si.destinationId === id) return true;
    }
    /** Step-level target is the “hotel” pin only when no interval pins a specific lodging row (province / hub row stays generic). */
    const hasIntervalLodgingPin = s.stepIntervals.some(
      (int) =>
        int.intervalType === "stay" &&
        Boolean((int as StayStepInterval).destinationId?.trim()),
    );
    if (!hasIntervalLodgingPin && s.targetDestinationId === id) return true;
  }
  return false;
}

function isTransitLinkedDestinationId(trip: Trip, id: string): boolean {
  for (const step of trip.steps) {
    if (step.stepType !== "transit") continue;
    const tr = step as TransitStep;
    if (tr.targetDestinationId === id) return true;
    for (const int of tr.stepIntervals) {
      if (int.intervalType !== "transit") continue;
      const ti = int as TransitStepInterval;
      if (ti.fromDestinationId === id || ti.toDestinationId === id) return true;
    }
  }
  return false;
}

function isStayAreaCenterId(trip: Trip, id: string): boolean {
  for (const step of trip.steps) {
    if (step.stepType !== "stay") continue;
    if ((step as StayStep).areaCenterDestinationId === id) return true;
  }
  return false;
}

function isActivityLinkedDestinationId(trip: Trip, id: string): boolean {
  for (const step of trip.steps) {
    if (step.stepType !== "activity") continue;
    const a = step as ActivityStep;
    if (a.destinationId === id || a.targetDestinationId === id) return true;
    for (const int of a.stepIntervals) {
      if (int.intervalType !== "activity") continue;
      const ai = int as ActivityStepInterval;
      if (ai.destinationId != null && ai.destinationId === id) return true;
    }
  }
  return false;
}

/**
 * Map pin icon for a registry {@link Destination}:
 * 1. **hotel** — lodging pin; wins over stay-area center and transit when the same id is all three.
 * 2. **stayArea** — stay geographic center (“location” pin); wins over transit when both apply without hotel.
 * 3. **transit** — transit step or leg endpoints when not hotel or stay-area center (bus pin).
 * 4. **activity** — activity step or interval place pin.
 * 5. **place** — everything else with coordinates.
 */
export function destinationMapPinCategory(trip: Trip, destinationId: string): MapDestinationPinCategory {
  if (isStayHotelDestinationId(trip, destinationId)) return "hotel";
  if (isStayAreaCenterId(trip, destinationId)) return "stayArea";
  if (isTransitLinkedDestinationId(trip, destinationId)) return "transit";
  if (isActivityLinkedDestinationId(trip, destinationId)) return "activity";
  return "place";
}
