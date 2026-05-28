/**
 * Trip recommendation queue: pending suggestions surfaced via the floating
 * notifications dock.
 *
 * Each recommendation is a bundle of options of the same `kind` (stay /
 * transit / activity). Every option embeds a full {@link StayStepInterval},
 * {@link TransitStepInterval}, or {@link ActivityStepInterval}. Approving an
 * option either **creates a new step** or, when {@link TripRecommendationOption}
 * carries `targetStepId`, **appends the interval** to that existing step’s
 * `stepIntervals` (same `stepType` as `kind`).
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
  TripRecommendationKind,
  TripRecommendationOption,
  TripStep,
} from "@/lib/types/trip";
import type { SharedTripThreadEntry } from "@/lib/types/user";
import { parseTripRecommendationsFromJsonString } from "@/lib/tripAssistantSuggestionSchema";

// ---------------------------------------------------------------------------
// Suggestion wizard: missing-field detection
// ---------------------------------------------------------------------------

/** Fields the suggestion wizard requires before an approved option is "complete". */
export type WizardMissingField = "price" | "time" | "note";

/**
 * Returns which required fields are missing from the approved option.
 * The wizard will auto-trigger follow-up suggestion rounds until all are present.
 */
export function getWizardMissingFields(
  option: TripRecommendationOption,
  rec: TripRecommendation
): WizardMissingField[] {
  const missing: WizardMissingField[] = [];
  if (!option.interval.startTime?.trim() || !option.interval.endTime?.trim()) {
    missing.push("time");
  }
  const intervalPrice = (option.interval as { price?: { amount?: number } }).price;
  const hasPrice =
    !!option.priceNote?.trim() ||
    (typeof intervalPrice?.amount === "number" && intervalPrice.amount > 0);
  if (!hasPrice) missing.push("price");
  const hasNote = !!option.note?.trim() || !!rec.note?.trim();
  if (!hasNote) missing.push("note");
  return missing;
}

// ---------------------------------------------------------------------------

/** Queue tombstone so thread-based sync never re-adds a removed or approved recommendation. */
function withRemovedRecommendationQueueEntry(
  trip: Trip,
  recommendationId: string
): Pick<Trip, "removedRecommendationIds"> {
  const id = recommendationId.trim();
  const prev = trip.removedRecommendationIds ?? [];
  if (!id || prev.includes(id)) return { removedRecommendationIds: prev };
  return { removedRecommendationIds: [...prev, id] };
}

/** Append a fresh recommendation to the queue (no `destinations` merge yet — wait for approve). */
export function addTripRecommendation(trip: Trip, rec: TripRecommendation): Trip {
  return {
    ...trip,
    recommendations: [...(trip.recommendations ?? []), rec],
    updatedAt: new Date().toISOString(),
  };
}

/** Patches `imageUrl` and/or `priceNote` on a single recommendation option after lazy-loading. */
export function patchTripRecommendationOptionImage(
  trip: Trip,
  recId: string,
  optionId: string,
  imageUrl: string,
  priceNote?: string
): Trip {
  const recs = trip.recommendations ?? [];
  const idx = recs.findIndex((r) => r.id === recId);
  if (idx === -1) return trip;
  const rec = recs[idx];
  const updatedRec = {
    ...rec,
    options: rec.options.map((opt) =>
      opt.id === optionId
        ? { ...opt, imageUrl, ...(priceNote ? { priceNote } : {}) }
        : opt
    ),
  } as TripRecommendation;
  return {
    ...trip,
    recommendations: [
      ...recs.slice(0, idx),
      updatedRec,
      ...recs.slice(idx + 1),
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function removeTripRecommendation(trip: Trip, recommendationId: string): Trip {
  const list = trip.recommendations ?? [];
  if (!list.some((r) => r.id === recommendationId)) return trip;
  return {
    ...trip,
    recommendations: list.filter((r) => r.id !== recommendationId),
    ...withRemovedRecommendationQueueEntry(trip, recommendationId),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Merges validated `recommendationsJson` snapshots from the shared assistant thread into
 * `trip.recommendations` (chronological). Skips ids already on the trip or listed in
 * {@link Trip.removedRecommendationIds}. Returns `null` when nothing changed.
 */
export function mergeAssistantThreadRecommendationsIntoTrip(
  trip: Trip,
  threadEntries: SharedTripThreadEntry[]
): Trip | null {
  const tid = trip.id.trim();
  if (!tid) return null;
  const suppressed = new Set(trip.removedRecommendationIds ?? []);
  const existing = new Set((trip.recommendations ?? []).map((r) => r.id));
  let next = trip;
  let changed = false;
  const sorted = [...threadEntries]
    .filter(
      (e) =>
        e.tripId === tid &&
        e.active !== false &&
        e.role === "assistant" &&
        e.kind === "message" &&
        Boolean(e.recommendationsJson?.trim())
    )
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
  for (const e of sorted) {
    const raw = e.recommendationsJson!.trim();
    const createdAtIso = new Date(e.createdAtMs).toISOString();
    const parsed = parseTripRecommendationsFromJsonString(raw, createdAtIso);
    for (const rec of parsed) {
      if (suppressed.has(rec.id) || existing.has(rec.id)) continue;
      existing.add(rec.id);
      next = addTripRecommendation(next, rec);
      changed = true;
    }
  }
  return changed ? next : null;
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

function widenStepTimesAfterAppend(
  step: StayStep | TransitStep | ActivityStep
): StayStep | TransitStep | ActivityStep {
  const ints = step.stepIntervals;
  if (ints.length === 0) return step;
  const starts = ints.map((i) => new Date(i.startTime).getTime());
  const ends = ints.map((i) => new Date(i.endTime).getTime());
  if (!starts.every(Number.isFinite) || !ends.every(Number.isFinite)) return step;
  const startMs = Math.min(...starts);
  const endMs = Math.max(...ends);
  return {
    ...step,
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
  };
}

function mergeDestinationsForIntervalOnTrip(
  destinations: Destination[],
  kind: TripRecommendationKind,
  interval: StayStepInterval | TransitStepInterval | ActivityStepInterval
): Destination[] {
  let next = destinations;
  if (kind === "stay") {
    const sid = (interval as StayStepInterval).destinationId?.trim();
    if (sid) next = ensureDestinationRow(next, sid, interval.title);
    return next;
  }
  if (kind === "transit") {
    const ti = interval as TransitStepInterval;
    const a = ti.fromDestinationId?.trim();
    const b = ti.toDestinationId?.trim();
    if (a) next = ensureDestinationRow(next, a, ti.title);
    if (b) next = ensureDestinationRow(next, b, ti.title);
    return next;
  }
  const slotId = (interval as ActivityStepInterval).destinationId?.trim();
  if (slotId) next = ensureDestinationRow(next, slotId, interval.title);
  return next;
}

function resolveMergeStepIndex(
  trip: Trip,
  targetStepId: string | undefined,
  kind: TripRecommendationKind
): number {
  if (!targetStepId?.trim()) return -1;
  const idx = trip.steps.findIndex((s) => s.id === targetStepId.trim());
  if (idx === -1) return -1;
  return trip.steps[idx]!.stepType === kind ? idx : -1;
}

function approveMergeIntervalIntoStep(
  trip: Trip,
  recommendationId: string,
  stepIndex: number,
  kind: TripRecommendationKind,
  interval: StayStepInterval | TransitStepInterval | ActivityStepInterval,
  option: TripRecommendationOption,
  hostStayStepId: string | undefined
): { trip: Trip; createdStepId: string | null } {
  const mergedId = newId();
  const mergedInterval = { ...interval, id: mergedId };

  let nextDestinations = mergeDestinationLists(
    trip.destinations ?? [],
    option.destinations ?? []
  );
  nextDestinations = mergeDestinationsForIntervalOnTrip(nextDestinations, kind, mergedInterval);

  const step = trip.steps[stepIndex]!;
  let nextStep: TripStep;

  if (kind === "stay" && step.stepType === "stay") {
    const si = mergedInterval as StayStepInterval;
    const intervals = [...step.stepIntervals, si];
    nextStep = widenStepTimesAfterAppend({ ...step, stepIntervals: intervals });
  } else if (kind === "transit" && step.stepType === "transit") {
    const ti = mergedInterval as TransitStepInterval;
    const intervals = [...step.stepIntervals, ti];
    nextStep = widenStepTimesAfterAppend({ ...step, stepIntervals: intervals });
  } else if (kind === "activity" && step.stepType === "activity") {
    const slotId = (mergedInterval as ActivityStepInterval).destinationId?.trim() || newId();
    nextDestinations = ensureDestinationRow(nextDestinations, slotId, mergedInterval.title);
    const ai: ActivityStepInterval = {
      ...(mergedInterval as ActivityStepInterval),
      destinationId: slotId,
    };
    const intervals = [...step.stepIntervals, ai];
    let widened = widenStepTimesAfterAppend({ ...step, stepIntervals: intervals }) as ActivityStep;
    const host = sanitizeHostStayStepId(trip, hostStayStepId);
    if (host && !widened.hostStayStepId) widened = { ...widened, hostStayStepId: host };
    nextStep = widened;
  } else {
    return { trip, createdStepId: null };
  }

  const nextSteps = trip.steps.map((s, i) => (i === stepIndex ? nextStep : s));
  return {
    trip: {
      ...trip,
      destinations: nextDestinations,
      steps: normalizeStepOrders(nextSteps),
      recommendations: (trip.recommendations ?? []).filter((r) => r.id !== recommendationId),
      ...withRemovedRecommendationQueueEntry(trip, recommendationId),
      updatedAt: new Date().toISOString(),
    },
    createdStepId: step.id,
  };
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
 * Promote one option of a queued recommendation:
 *   1. merge any destinations carried on the option into the trip registry,
 *   2. either append the interval onto `targetStepId` when valid, or build a new
 *      single-interval step of the matching type,
 *   3. remove the entire recommendation from the queue.
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

  const mergeIdx = resolveMergeStepIndex(trip, option.targetStepId, rec.kind);
  if (mergeIdx !== -1 && option.interval.intervalType === rec.kind) {
    const host =
      rec.kind === "activity" ? (option as ActivityRecommendationOption).hostStayStepId : undefined;
    return approveMergeIntervalIntoStep(
      trip,
      recommendationId,
      mergeIdx,
      rec.kind,
      option.interval,
      option,
      host
    );
  }

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
      ...withRemovedRecommendationQueueEntry(trip, recommendationId),
      updatedAt: new Date().toISOString(),
    },
    createdStepId: next.step.id,
  };
}

export function tripRecommendationCount(trip: Trip | null | undefined): number {
  return trip?.recommendations?.length ?? 0;
}

/**
 * Collaborative voting on a recommendation's option. Each traveler votes for at
 * most one option per recommendation; calling this with the existing pair
 * removes the vote (toggle behaviour). Voter identities are stored as
 * lowercased emails to match traveler / viewer rows.
 */
export function toggleRecommendationVote(
  trip: Trip,
  recommendationId: string,
  optionId: string,
  travelerIdLower: string
): Trip {
  const id = travelerIdLower.trim().toLowerCase();
  if (!id) return trip;
  const list = trip.recommendationVotes ?? [];
  const existing = list.find(
    (v) =>
      v.recommendationId === recommendationId &&
      v.travelerId === id
  );
  let next = list.filter(
    (v) => !(v.recommendationId === recommendationId && v.travelerId === id)
  );
  if (!existing || existing.optionId !== optionId) {
    next = [
      ...next,
      {
        recommendationId,
        optionId,
        travelerId: id,
        createdAt: new Date().toISOString(),
      },
    ];
  }
  return { ...trip, recommendationVotes: next, updatedAt: new Date().toISOString() };
}

export function votesForOption(
  trip: Trip | null | undefined,
  recommendationId: string,
  optionId: string
): string[] {
  return (trip?.recommendationVotes ?? [])
    .filter((v) => v.recommendationId === recommendationId && v.optionId === optionId)
    .map((v) => v.travelerId);
}
