/**
 * Trip recommendation queue: pending suggestions surfaced via the floating
 * notifications dock.
 *
 * Each recommendation is a bundle of options of the same `kind` (stay /
 * transit / activity). Every option embeds a full {@link StayStepInterval},
 * {@link TransitStepInterval}, or {@link ActivityStepInterval} so approving an
 * option converts it into a brand-new step without further data entry.
 *
 * Recommendations live on `Trip.recommendations` (alongside `steps`) so the
 * queue is order-independent — assistants and tooling can author them without
 * rewriting the itinerary, and dismissing a card never disturbs other steps.
 */

import { newId } from "@/lib/canonicalIds";
import { normalizeStepOrders } from "@/lib/canonicalStepBuilders";
import { mergeDestinationLists } from "@/lib/tripDestinationRegistry";
import type {
  ActivityRecommendationOption,
  ActivityStep,
  ActivityStepInterval,
  Destination,
  StayStep,
  StayStepInterval,
  TransitStep,
  TransitStepInterval,
  Trip,
  TripRecommendation,
  TripRecommendationOption,
  TripStep,
} from "@/lib/types/trip";

/** Append a fresh recommendation to the queue (no `destinations` merge yet — wait for approve). */
export function addTripRecommendation(trip: Trip, rec: TripRecommendation): Trip {
  return {
    ...trip,
    recommendations: [...(trip.recommendations ?? []), rec],
    updatedAt: new Date().toISOString(),
  };
}

export function removeTripRecommendation(trip: Trip, recommendationId: string): Trip {
  const list = trip.recommendations ?? [];
  if (!list.some((r) => r.id === recommendationId)) return trip;
  return {
    ...trip,
    recommendations: list.filter((r) => r.id !== recommendationId),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * "Skip" action: keep the recommendation in the queue but mark it as `seen`
 * (so the bell stops flagging it as new) and move it to the end so the user
 * sees fresh, unseen entries first when they reopen the dock.
 */
export function skipTripRecommendation(trip: Trip, recommendationId: string): Trip {
  const list = trip.recommendations ?? [];
  const idx = list.findIndex((r) => r.id === recommendationId);
  if (idx === -1) return trip;
  const target = { ...list[idx], seen: true } as TripRecommendation;
  const next = [...list.slice(0, idx), ...list.slice(idx + 1), target];
  return {
    ...trip,
    recommendations: next,
    updatedAt: new Date().toISOString(),
  };
}

/** Mark one recommendation as viewed (`seen`) without changing queue order. No-op if unknown or already seen. */
export function markTripRecommendationSeen(trip: Trip, recommendationId: string): Trip {
  const list = trip.recommendations ?? [];
  const idx = list.findIndex((r) => r.id === recommendationId);
  if (idx === -1) return trip;
  const target = list[idx];
  if (target.seen) return trip;
  const next = [...list];
  next[idx] = { ...target, seen: true } as TripRecommendation;
  return {
    ...trip,
    recommendations: next,
    updatedAt: new Date().toISOString(),
  };
}

/** Number of unseen (still "new") recommendations in the queue. */
export function unseenTripRecommendationCount(trip: Trip | null | undefined): number {
  return (trip?.recommendations ?? []).filter((r) => !r.seen).length;
}

function findRecommendation(
  trip: Trip,
  recommendationId: string
): TripRecommendation | undefined {
  return (trip.recommendations ?? []).find((r) => r.id === recommendationId);
}

function findOption(
  rec: TripRecommendation,
  optionId: string
): TripRecommendationOption | undefined {
  return (rec.options as TripRecommendationOption[]).find((o) => o.id === optionId);
}

function placeholderDestination(id: string, hint?: string): Destination {
  const title = (hint ?? "").trim();
  return { id, title, location: title, description: title };
}

function ensureDestinationRow(rows: Destination[], id: string, hint?: string): Destination[] {
  if (rows.some((d) => d.id === id)) return rows;
  return [...rows, placeholderDestination(id, hint)];
}

function buildStayStepFromInterval(
  interval: StayStepInterval,
  order: number,
  destinations: Destination[]
): { step: StayStep; destinations: Destination[] } {
  let nextDestinations = destinations;
  let targetDestinationId =
    interval.destinationId?.trim() || nextDestinations[0]?.id || "";
  if (!targetDestinationId) {
    targetDestinationId = newId();
    nextDestinations = ensureDestinationRow(nextDestinations, targetDestinationId, interval.title);
  } else {
    nextDestinations = ensureDestinationRow(nextDestinations, targetDestinationId, interval.title);
  }
  const stayInterval: StayStepInterval = {
    ...interval,
    destinationId: interval.destinationId ?? targetDestinationId,
  };
  const step: StayStep = {
    id: newId(),
    order,
    stepType: "stay",
    title: (interval.title ?? "").trim() || "Stay",
    startTime: interval.startTime,
    endTime: interval.endTime,
    targetDestinationId,
    stepIntervals: [stayInterval],
  };
  return { step, destinations: nextDestinations };
}

function buildTransitStepFromInterval(
  interval: TransitStepInterval,
  order: number,
  destinations: Destination[]
): { step: TransitStep; destinations: Destination[] } {
  let nextDestinations = destinations;
  const fromStayId = interval.fromDestinationId?.trim() || newId();
  const toStayId = interval.toDestinationId?.trim() || newId();
  nextDestinations = ensureDestinationRow(nextDestinations, fromStayId, interval.title);
  nextDestinations = ensureDestinationRow(nextDestinations, toStayId, interval.title);
  // Step-level row is its own placeholder so syncTripTransitTargetsFromLegs can rewrite it
  // safely on persist (it points the row at the leg's `to` when bare).
  const targetDestinationId = newId();
  nextDestinations = ensureDestinationRow(
    nextDestinations,
    targetDestinationId,
    interval.title
  );
  const transitInterval: TransitStepInterval = {
    ...interval,
    fromDestinationId: fromStayId,
    toDestinationId: toStayId,
  };
  const step: TransitStep = {
    id: newId(),
    order,
    stepType: "transit",
    title: (interval.title ?? "").trim() || "Transit",
    startTime: interval.startTime,
    endTime: interval.endTime,
    targetDestinationId,
    fromStayId,
    toStayId,
    stepIntervals: [transitInterval],
  };
  return { step, destinations: nextDestinations };
}

function sanitizeHostStayStepId(trip: Trip, raw: string | undefined): string | undefined {
  const id = raw?.trim();
  if (!id) return undefined;
  const s = trip.steps.find((x) => x.id === id);
  return s?.stepType === "stay" ? id : undefined;
}

function buildActivityStepFromInterval(
  interval: ActivityStepInterval,
  order: number,
  destinations: Destination[],
  trip: Trip,
  hostStayStepId?: string
): { step: ActivityStep; destinations: Destination[] } {
  let nextDestinations = destinations;
  const slotId = interval.destinationId?.trim() || newId();
  nextDestinations = ensureDestinationRow(nextDestinations, slotId, interval.title);
  // Mirror `createActivityStep`: dedicated `targetDestinationId` row even when the slot
  // points at the same place, so the registry pruner doesn't drop the activity hub.
  const tgtId = newId();
  nextDestinations = ensureDestinationRow(nextDestinations, tgtId, interval.title);
  const activityInterval: ActivityStepInterval = {
    ...interval,
    destinationId: slotId,
  };
  const host = sanitizeHostStayStepId(trip, hostStayStepId);
  const step: ActivityStep = {
    id: newId(),
    order,
    stepType: "activity",
    title: (interval.title ?? "").trim() || "Activity",
    startTime: interval.startTime,
    endTime: interval.endTime,
    destinationId: slotId,
    targetDestinationId: tgtId,
    stepIntervals: [activityInterval],
    ...(host ? { hostStayStepId: host } : {}),
  };
  return { step, destinations: nextDestinations };
}

/**
 * Promote one option of a queued recommendation into a real step:
 *   1. merge any destinations carried on the option into the trip registry,
 *   2. build a single-interval step of the matching type,
 *   3. append the step + remove the entire recommendation from the queue.
 *
 * Returns the original trip when `recommendationId` / `optionId` are unknown or
 * the kind doesn't match the option's interval type.
 */
export function approveTripRecommendationOption(
  trip: Trip,
  recommendationId: string,
  optionId: string
): Trip {
  return approveTripRecommendationOptionDetailed(trip, recommendationId, optionId).trip;
}

export function approveTripRecommendationOptionDetailed(
  trip: Trip,
  recommendationId: string,
  optionId: string
): { trip: Trip; createdStepId: string | null } {
  const rec = findRecommendation(trip, recommendationId);
  if (!rec) return { trip, createdStepId: null };
  const option = findOption(rec, optionId);
  if (!option) return { trip, createdStepId: null };

  const seededDestinations = mergeDestinationLists(
    trip.destinations ?? [],
    option.destinations ?? []
  );
  const order = trip.steps.length;

  let next: { step: TripStep; destinations: Destination[] };
  if (rec.kind === "stay" && option.interval.intervalType === "stay") {
    next = buildStayStepFromInterval(option.interval, order, seededDestinations);
  } else if (rec.kind === "transit" && option.interval.intervalType === "transit") {
    next = buildTransitStepFromInterval(option.interval, order, seededDestinations);
  } else if (rec.kind === "activity" && option.interval.intervalType === "activity") {
    const actOpt = option as ActivityRecommendationOption;
    next = buildActivityStepFromInterval(
      option.interval,
      order,
      seededDestinations,
      trip,
      actOpt.hostStayStepId
    );
  } else {
    /** Mismatched kind / interval — refuse silently rather than fabricating a wrong step. */
    return { trip, createdStepId: null };
  }

  return {
    trip: {
      ...trip,
      destinations: next.destinations,
      steps: normalizeStepOrders([...trip.steps, next.step]),
      recommendations: (trip.recommendations ?? []).filter((r) => r.id !== recommendationId),
      updatedAt: new Date().toISOString(),
    },
    createdStepId: next.step.id,
  };
}

export function tripRecommendationCount(trip: Trip | null | undefined): number {
  return trip?.recommendations?.length ?? 0;
}
