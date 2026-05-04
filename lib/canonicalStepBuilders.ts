import { newId } from "@/lib/canonicalIds";
import type { PlaceSearchPickPayload } from "@/lib/places/types";
import {
  destinationFromList,
  mergeDestinationLists,
  normalizeTripDestinationRows,
  pruneUnreferencedDestinations,
} from "@/lib/tripDestinationRegistry";
import type {
  ActivityStep,
  ActivityStepInterval,
  Destination,
  StayStep,
  StayStepInterval,
  TransitStep,
  TransitStepInterval,
  Trip,
  TripStep,
} from "@/lib/types/trip";

export function emptyDestination(): Destination {
  return { id: newId(), title: "", location: "", description: "" };
}

/** Build a full {@link Destination} from an autocomplete pick. */
export function destinationFromPlacePick(
  p: PlaceSearchPickPayload,
  opts?: { id?: string }
): Destination {
  const id = p.destinationId ?? opts?.id ?? newId();
  const location = p.label.trim();
  const title = (p.title?.trim() || location.split(",")[0]?.trim() || location).trim() || "Place";
  const description = (p.description?.trim() || location).trim() || "";
  const lat = p.lat;
  const lng = p.lng;
  const coords =
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lon: lng }
      : undefined;
  return {
    id,
    title,
    location,
    description,
    ...(coords ? { coordinates: coords } : {}),
  };
}

/** User typed the address field without picking a row — clear geocode and description context. */
export function destinationFromTypedLocation(prev: Destination, location: string): Destination {
  return {
    ...prev,
    location,
    coordinates: undefined,
    description: "",
  };
}

function defaultIntervalWindow(tripStartIso: string): { start: string; end: string } {
  const a = new Date(tripStartIso);
  const base = Number.isNaN(a.getTime()) ? new Date() : a;
  const end = new Date(base);
  end.setHours(end.getHours() + 1);
  return { start: base.toISOString(), end: end.toISOString() };
}

export type NewStepBundle = { step: TripStep; newDestinations: Destination[] };

export function createStayStep(order: number, tripStartIso: string): NewStepBundle {
  const { start, end } = defaultIntervalWindow(tripStartIso);
  const stayDestId = newId();
  const stayRow: Destination = {
    id: stayDestId,
    title: "",
    location: "",
    description: "",
  };
  const interval: StayStepInterval = {
    id: newId(),
    title: "Stay",
    intervalType: "stay",
    stayType: "hotel",
    startTime: start,
    endTime: end,
    location: "",
  };
  const step: StayStep = {
    id: newId(),
    order,
    stepType: "stay",
    title: "",
    startTime: start,
    endTime: end,
    targetDestinationId: stayDestId,
    stepIntervals: [interval],
  };
  return { step, newDestinations: [stayRow] };
}

export function createTransitStep(order: number, tripStartIso: string): NewStepBundle {
  const { start, end } = defaultIntervalWindow(tripStartIso);
  const fromId = newId();
  const toId = newId();
  const legId = newId();
  const interval: TransitStepInterval = {
    id: newId(),
    title: "Transit",
    intervalType: "transit",
    transitType: "flight",
    startTime: start,
    endTime: end,
    fromDestinationId: fromId,
    toDestinationId: toId,
  };
  const fromRow: Destination = { id: fromId, title: "", location: "", description: "" };
  const toRow: Destination = { id: toId, title: "", location: "", description: "" };
  const legRow: Destination = {
    id: legId,
    title: "Transit leg",
    location: "",
    description: "",
  };
  const step: TransitStep = {
    id: newId(),
    order,
    stepType: "transit",
    title: "",
    startTime: start,
    endTime: end,
    targetDestinationId: legId,
    fromStayId: fromId,
    toStayId: toId,
    stepIntervals: [interval],
  };
  return { step, newDestinations: [fromRow, toRow, legRow] };
}

export function createActivityStep(order: number, tripStartIso: string): NewStepBundle {
  const { start, end } = defaultIntervalWindow(tripStartIso);
  const destId = newId();
  const tgtId = newId();
  const destRow: Destination = { id: destId, title: "", location: "", description: "" };
  const tgtRow: Destination = { id: tgtId, title: "", location: "", description: "" };
  const interval: ActivityStepInterval = {
    id: newId(),
    title: "Activity",
    intervalType: "activity",
    activityType: "other",
    startTime: start,
    endTime: end,
    destinationId: destId,
  };
  const step: ActivityStep = {
    id: newId(),
    order,
    stepType: "activity",
    title: "",
    startTime: start,
    endTime: end,
    destinationId: destId,
    targetDestinationId: tgtId,
    stepIntervals: [interval],
  };
  return { step, newDestinations: [destRow, tgtRow] };
}

/** Assigns `order` from the array sequence (caller order — e.g. drag order or insert order). */
export function normalizeStepOrders(steps: TripStep[]): TripStep[] {
  return steps.map((s, idx) => ({ ...s, order: idx }));
}

/** Next interval time window: after previous `endTime`, or from trip start when missing. */
function nextIntervalRange(
  lastEndIso: string | undefined,
  tripStartIso: string
): { startISO: string; endISO: string } {
  const baseStart = lastEndIso
    ? new Date(lastEndIso)
    : (() => {
        const t = new Date(tripStartIso);
        return Number.isNaN(t.getTime()) ? new Date() : t;
      })();
  const end = new Date(baseStart);
  end.setHours(end.getHours() + 1);
  return { startISO: baseStart.toISOString(), endISO: end.toISOString() };
}

export type AppendIntervalResult<S extends StayStep | TransitStep | ActivityStep> = {
  step: S;
  /** New registry rows to merge into {@link Trip#destinations} (activity slots only today). */
  newDestinations: Destination[];
};

/**
 * Append another stay, transit, or activity interval after the last one (same time-window rule).
 * Pass `trip` so stay default location and activity slot destinations resolve from the registry.
 */
export function appendStepInterval(step: StayStep, tripStartIso: string, trip: Trip): AppendIntervalResult<StayStep>;
export function appendStepInterval(
  step: TransitStep,
  tripStartIso: string,
  trip: Trip
): AppendIntervalResult<TransitStep>;
export function appendStepInterval(
  step: ActivityStep,
  tripStartIso: string,
  trip: Trip
): AppendIntervalResult<ActivityStep>;
export function appendStepInterval(
  step: StayStep | TransitStep | ActivityStep,
  tripStartIso: string,
  trip: Trip
): AppendIntervalResult<StayStep | TransitStep | ActivityStep> {
  const last = step.stepIntervals[step.stepIntervals.length - 1];
  const { startISO, endISO } = nextIntervalRange(last?.endTime, tripStartIso);

  if (step.stepType === "stay") {
    const refStay = last?.intervalType === "stay" ? last : undefined;
    const main = trip.destinations.find((d) => d.id === step.targetDestinationId);
    const loc =
      refStay?.intervalType === "stay"
        ? (refStay.location ?? "").trim() || (main?.location ?? "").trim()
        : (main?.location ?? "").trim();

    const newInterval: StayStepInterval = {
      id: newId(),
      title: "Stay",
      intervalType: "stay",
      stayType: refStay?.stayType ?? "hotel",
      startTime: startISO,
      endTime: endISO,
      location: loc,
    };

    return {
      step: {
        ...step,
        stepIntervals: [...step.stepIntervals, newInterval],
      },
      newDestinations: [],
    };
  }

  if (step.stepType === "transit") {
    const refTransit = last?.intervalType === "transit" ? last : undefined;
    const newInterval: TransitStepInterval = {
      id: newId(),
      title: "Transit",
      intervalType: "transit",
      transitType: refTransit?.transitType ?? "flight",
      startTime: startISO,
      endTime: endISO,
    };

    return {
      step: {
        ...step,
        stepIntervals: [...step.stepIntervals, newInterval],
      },
      newDestinations: [],
    };
  }

  const refAct = last?.intervalType === "activity" ? last : undefined;
  const templateId = refAct?.intervalType === "activity" ? refAct.destinationId : step.destinationId;
  const template = templateId ? trip.destinations.find((d) => d.id === templateId) : undefined;
  const newSlotId = newId();
  const destTemplate: Destination = template
    ? { ...template, id: newSlotId }
    : { id: newSlotId, title: "", location: "", description: "" };

  const newInterval: ActivityStepInterval = {
    id: newId(),
    title: "Activity",
    intervalType: "activity",
    activityType: refAct?.activityType ?? "other",
    startTime: startISO,
    endTime: endISO,
    destinationId: newSlotId,
  };

  return {
    step: {
      ...step,
      stepIntervals: [...step.stepIntervals, newInterval],
    },
    newDestinations: [destTemplate],
  };
}

type IntervalLike = { startTime: string; endTime: string };

function earliestIso(intervals: IntervalLike[]): string | null {
  let bestMs = Infinity;
  let bestIso: string | null = null;
  for (const int of intervals) {
    const ms = Date.parse(int.startTime);
    if (Number.isNaN(ms)) continue;
    if (ms < bestMs) {
      bestMs = ms;
      bestIso = int.startTime;
    }
  }
  return bestIso;
}

function latestIso(intervals: IntervalLike[]): string | null {
  let bestMs = -Infinity;
  let bestIso: string | null = null;
  for (const int of intervals) {
    const ms = Date.parse(int.endTime);
    if (Number.isNaN(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      bestIso = int.endTime;
    }
  }
  return bestIso;
}

/**
 * Sets step `startTime` / `endTime` to the span of all intervals (min start → max end).
 * Stay steps: if `manualEndStayTime` is set, `endTime` is the later of that and the max interval end.
 */
export function syncStepTimesFromIntervals(step: TripStep): TripStep {
  const intervals = step.stepIntervals;
  if (!intervals.length) return step;
  const startIso = earliestIso(intervals);
  const endIso = latestIso(intervals);
  if (!startIso || !endIso) return step;

  let endTime = endIso;
  if (step.stepType === "stay") {
    const s = step as StayStep;
    const manual = s.manualEndStayTime;
    if (manual) {
      const m = Date.parse(manual);
      const e = Date.parse(endTime);
      if (!Number.isNaN(m) && !Number.isNaN(e) && m > e) endTime = manual;
    }
  }

  return {
    ...step,
    startTime: startIso,
    endTime,
  };
}

/** @deprecated Use {@link syncStepTimesFromIntervals} (same behavior: span of all intervals). */
export const syncStepTimesFromFirstInterval = syncStepTimesFromIntervals;

/** Normalizes every step’s window from its intervals (e.g. before persisting a trip). */
export function syncTripStepTimesFromIntervals(trip: Trip): Trip {
  return {
    ...trip,
    steps: trip.steps.map(syncStepTimesFromIntervals),
  };
}

/** Ensures every {@link Trip#destinations} row has required string fields (legacy / hand-edited JSON). */
export function normalizeTripDestinations(trip: Trip): Trip {
  return normalizeTripDestinationRows(trip);
}

function hasDestinationRow(destinations: Destination[], id: string | undefined): boolean {
  if (!id) return false;
  return destinations.some((d) => d.id === id);
}

/**
 * Multiple transit steps sometimes share one empty `targetDestinationId` (legacy / bad merge).
 * Give each additional step its own registry row so per-step sync from legs does not clobber
 * another transit’s step-level place.
 */
export function dedupeSharedTransitStepTargets(trip: Trip): Trip {
  const indexed = trip.steps
    .map((s, idx) => ({ s, idx }))
    .filter((x): x is { s: TransitStep; idx: number } => x.s.stepType === "transit");

  const byTarget = new Map<string, { s: TransitStep; idx: number }[]>();
  for (const x of indexed) {
    const tid = x.s.targetDestinationId;
    if (!byTarget.has(tid)) byTarget.set(tid, []);
    byTarget.get(tid)!.push(x);
  }

  const stepIdToNewTarget = new Map<string, string>();
  const newRows: Destination[] = [];

  for (const group of byTarget.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort((a, b) => a.idx - b.idx);
    for (let i = 1; i < sorted.length; i++) {
      const nid = newId();
      newRows.push({ id: nid, title: "", location: "", description: "" });
      stepIdToNewTarget.set(sorted[i].s.id, nid);
    }
  }

  if (newRows.length === 0) return trip;

  const steps = trip.steps.map((step) => {
    const nid = stepIdToNewTarget.get(step.id);
    if (!nid || step.stepType !== "transit") return step;
    return { ...step, targetDestinationId: nid };
  });

  return {
    ...trip,
    steps,
    destinations: mergeDestinationLists(trip.destinations, newRows),
  };
}

/** If `fromStayId` / `toStayId` point at ids missing from `destinations`, fall back to the first / last transit leg ids. */
export function repairTransitStepHubDestinationIds(trip: Trip): Trip {
  const { destinations } = trip;
  const steps = trip.steps.map((step) => {
    if (step.stepType !== "transit") return step;
    const t = step as TransitStep;
    const legs = t.stepIntervals.filter(
      (i): i is TransitStepInterval => i.intervalType === "transit"
    );
    let fromStayId = t.fromStayId;
    let toStayId = t.toStayId;

    if (!hasDestinationRow(destinations, fromStayId)) {
      const first = legs[0];
      if (first?.fromDestinationId?.trim()) fromStayId = first.fromDestinationId;
    }
    if (!hasDestinationRow(destinations, toStayId)) {
      const last = legs[legs.length - 1];
      if (last?.toDestinationId?.trim()) toStayId = last.toDestinationId;
    }

    if (fromStayId === t.fromStayId && toStayId === t.toStayId) return step;
    return { ...t, fromStayId, toStayId };
  });

  return { ...trip, steps };
}

function destinationPlaceIsBare(d: Destination | undefined): boolean {
  if (!d) return true;
  if ((d.title ?? "").trim()) return false;
  if ((d.location ?? "").trim()) return false;
  const c = d.coordinates;
  if (
    c &&
    typeof c.lat === "number" &&
    typeof c.lon === "number" &&
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lon)
  )
    return false;
  return true;
}

function resolveTransitTargetSourceDestinationId(step: TransitStep): string | undefined {
  const legs = step.stepIntervals.filter(
    (i): i is TransitStepInterval => i.intervalType === "transit"
  );
  for (let i = legs.length - 1; i >= 0; i--) {
    const id = legs[i].toDestinationId;
    if (id?.trim()) return id;
  }
  const hub = step.toStayId?.trim();
  return hub || undefined;
}

/**
 * When the step-level transit row (`targetDestinationId`) is still empty, point it at the same
 * registry id as the last leg’s arrival (or `toStayId`) instead of copying fields into a second
 * row — avoids duplicate roster cards for one physical place. Drops the orphan placeholder row
 * on prune. Leaves non-bare step-level rows untouched so a custom “step / leg place” stays separate.
 */
export function syncTripTransitTargetsFromLegs(trip: Trip): Trip {
  const { destinations } = trip;
  let changed = false;
  const steps = trip.steps.map((step) => {
    if (step.stepType !== "transit") return step;
    const t = step as TransitStep;
    const targetRow = destinationFromList(destinations, t.targetDestinationId);
    if (!targetRow || !destinationPlaceIsBare(targetRow)) return step;

    const sourceId = resolveTransitTargetSourceDestinationId(t);
    if (!sourceId || sourceId === t.targetDestinationId) return step;

    const sourceRow = destinationFromList(destinations, sourceId);
    if (!sourceRow || destinationPlaceIsBare(sourceRow)) return step;

    changed = true;
    return { ...t, targetDestinationId: sourceId };
  });

  if (!changed) return trip;
  return pruneUnreferencedDestinations({ ...trip, steps });
}

/** Run before cloud/local save: destination strings + step time spans from intervals. */
export function normalizeTripForPersist(trip: Trip): Trip {
  const normalized = normalizeTripDestinations(trip);
  const dedupedTargets = dedupeSharedTransitStepTargets(normalized);
  const hubsRepaired = repairTransitStepHubDestinationIds(dedupedTargets);
  const withTransitTargets = syncTripTransitTargetsFromLegs(hubsRepaired);
  return syncTripStepTimesFromIntervals(withTransitTargets);
}
