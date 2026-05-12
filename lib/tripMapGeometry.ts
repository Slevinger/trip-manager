import {
  coordsFromDestination,
  haversineDistanceMeters,
  type LatLng,
} from "@/lib/tripDestinationGeo";
import { destinationFromList } from "@/lib/tripDestinationRegistry";
import type { CurrentStepFocus } from "@/lib/tripViewPhase";
import type {
  ActivityStep,
  Destination,
  StayStep,
  StayStepInterval,
  TransitStep,
  TransitStepInterval,
  TripStep,
} from "@/lib/types/trip";

export type { LatLng } from "@/lib/tripDestinationGeo";

/** Tooltip: endpoint continues from the prior drawn transit leg (no named registry row). */
export const TRANSIT_EDGE_LABEL_PRIOR_LEG = "__transit_prior_leg__";
/** Tooltip: endpoint bridges toward the next leg’s start (label unknown). */
export const TRANSIT_EDGE_LABEL_NEXT_LEG = "__transit_next_leg__";

export function destinationDisplayLine(d: Destination | undefined): string {
  if (!d) return "—";
  const title = (d.title ?? "").trim();
  const loc = (d.location ?? "").trim();
  if (title && loc && title !== loc) return `${title} · ${loc}`;
  return title || loc || "—";
}
export { coordsFromDestination, destinationHasMapCoordinates } from "@/lib/tripDestinationGeo";

export type StayMapPoint = {
  /** Parent stay step id (used for map focus when that step is highlighted). */
  stepId: string;
  /** Stay interval id when this pin is for a specific period; omitted for legacy single-pin data. */
  intervalId?: string;
  title: string;
  position: LatLng;
  startTime: string;
  endTime?: string;
  /** Address / place line for tooltips */
  placeLabel: string;
};

function coordsFromStayInterval(si: StayStepInterval): LatLng | null {
  const c = si.coordinates;
  if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
    return { lat: c.lat, lng: c.lon };
  }
  return null;
}

/** Resolved map position for one stay interval (interval coords → registry → step default). */
export function resolveStayIntervalLatLng(
  step: StayStep,
  si: StayStepInterval,
  destinations: Destination[]
): LatLng | null {
  const main = destinationFromList(destinations, step.targetDestinationId);
  const fallbackPos = coordsFromDestination(main);
  const intervalDest = destinationFromList(destinations, si.destinationId);
  return (
    coordsFromStayInterval(si) ?? coordsFromDestination(intervalDest) ?? fallbackPos ?? null
  );
}

export type StayAreaDestinationRow = {
  title: string;
  /** Address / place line when present */
  placeLine?: string;
};

export type StayAreaCircle = {
  stepId: string;
  center: LatLng;
  /** Geographic radius in meters (max distance from center to any stay-interval pin). */
  radiusMeters: number;
  title: string;
  placeLabel: string;
  /**
   * Destinations to show in the map tooltip: stay-linked rows first (area center, step default,
   * interval-linked), then other trip destinations whose coordinates fall inside the circle.
   */
  destinationsInArea: StayAreaDestinationRow[];
};

const STAY_AREA_DESTINATION_RADIUS_BUFFER_M = 80;

function stayDestinationRowsInCircle(
  step: StayStep,
  center: LatLng,
  radiusMeters: number,
  areaCenterDestinationId: string,
  destinations: Destination[]
): StayAreaDestinationRow[] {
  const maxD = radiusMeters + STAY_AREA_DESTINATION_RADIUS_BUFFER_M;
  const tiedIds: string[] = [];
  const pushTied = (id: string | undefined) => {
    if (!id) return;
    if (!tiedIds.includes(id)) tiedIds.push(id);
  };
  pushTied(areaCenterDestinationId);
  pushTied(step.targetDestinationId);
  for (const int of step.stepIntervals) {
    if (int.intervalType !== "stay") continue;
    pushTied((int as StayStepInterval).destinationId);
  }

  const extraIds: string[] = [];
  for (const d of destinations) {
    if (tiedIds.includes(d.id)) continue;
    const pos = coordsFromDestination(d);
    if (!pos) continue;
    if (haversineDistanceMeters(center, pos) <= maxD) extraIds.push(d.id);
  }
  extraIds.sort((a, b) => {
    const ta = (destinationFromList(destinations, a)?.title ?? a).toLocaleLowerCase();
    const tb = (destinationFromList(destinations, b)?.title ?? b).toLocaleLowerCase();
    return ta.localeCompare(tb);
  });

  const rowForId = (id: string): StayAreaDestinationRow => {
    const d = destinationFromList(destinations, id);
    const title = ((d?.title ?? "").trim() || id).trim() || "—";
    const loc = (d?.location ?? "").trim();
    return loc ? { title, placeLine: loc } : { title };
  };

  return [...tiedIds, ...extraIds].map(rowForId);
}

/**
 * One circle per stay that has {@link StayStep#areaCenterDestinationId} with coordinates and at
 * least one anchor point. Radius is the greatest haversine distance from the center to: each stay
 * interval’s resolved pin; registry coordinates for the **last** stay interval’s linked destination
 * (when set); and for each **Stay → Transit → Stay** chain: the **origin** stay’s radius includes the
 * transit journey **source** (first leg `from`); the **destination** stay’s radius includes the
 * transit journey **target** (last leg `to`).
 */
export function collectStayAreaCircles(
  sortedSteps: TripStep[],
  destinations: Destination[]
): StayAreaCircle[] {
  const MIN_VISIBLE_M = 90;
  const out: StayAreaCircle[] = [];
  for (let stepIdx = 0; stepIdx < sortedSteps.length; stepIdx++) {
    const s = sortedSteps[stepIdx]!;
    if (s.stepType !== "stay") continue;
    const step = s as StayStep;
    const cid = step.areaCenterDestinationId;
    if (!cid) continue;
    const centerDest = destinationFromList(destinations, cid);
    const center = coordsFromDestination(centerDest);
    if (!center) continue;

    const intervalPositions: LatLng[] = [];
    let lastStayInterval: StayStepInterval | null = null;
    for (const int of step.stepIntervals) {
      if (int.intervalType !== "stay") continue;
      const si = int as StayStepInterval;
      lastStayInterval = si;
      const pos = resolveStayIntervalLatLng(step, si, destinations);
      if (pos) intervalPositions.push(pos);
    }
    if (lastStayInterval?.destinationId) {
      const reg = coordsFromDestination(
        destinationFromList(destinations, lastStayInterval.destinationId)
      );
      if (reg) intervalPositions.push(reg);
    }

    if (stepIdx + 1 < sortedSteps.length) {
      const next = sortedSteps[stepIdx + 1]!;
      if (next.stepType === "transit") {
        const journeySource = stepEntryAnchor(next, destinations);
        if (journeySource) intervalPositions.push(journeySource);
      }
    }
    if (stepIdx > 0) {
      const prev = sortedSteps[stepIdx - 1]!;
      if (prev.stepType === "transit") {
        const journeyTarget = stepExitAnchor(prev, destinations);
        if (journeyTarget) intervalPositions.push(journeyTarget);
      }
    }

    if (intervalPositions.length === 0) continue;

    let maxM = 0;
    for (const p of intervalPositions) {
      const d = haversineDistanceMeters(center, p);
      if (d > maxM) maxM = d;
    }
    const radiusMeters = maxM > 0 ? maxM : MIN_VISIBLE_M;

    const placeLabel =
      (centerDest?.location ?? "").trim() ||
      (centerDest?.title ?? "").trim() ||
      "—";
    const title = (step.title || centerDest?.title || "Stay").trim() || "Stay";
    const destinationsInArea = stayDestinationRowsInCircle(step, center, radiusMeters, cid, destinations);
    out.push({
      stepId: step.id,
      center,
      radiusMeters,
      title,
      placeLabel,
      destinationsInArea,
    });
  }
  return out;
}

/** Approximate corners for fitting map bounds to a geographic circle. */
export function approximateCircleBounds(center: LatLng, radiusMeters: number): LatLng[] {
  const R = 6371000;
  const dLat = (radiusMeters / R) * (180 / Math.PI);
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const dLng =
    cosLat > 1e-6 ? ((radiusMeters / R) * (180 / Math.PI)) / cosLat : dLat;
  return [
    { lat: center.lat + dLat, lng: center.lng + dLng },
    { lat: center.lat - dLat, lng: center.lng - dLng },
  ];
}

/**
 * Stay intervals grouped by the destination list row used for their map pin: interval
 * {@link StayStepInterval#destinationId} when set, otherwise the stay step’s
 * {@link StayStep#targetDestinationId}. Only intervals whose pin destination has saved coordinates
 * appear (pins are always registry coordinates).
 */
export function collectStaysByPinDestination(
  sortedSteps: TripStep[],
  destinations: Destination[]
): Map<string, StayMapPoint[]> {
  const m = new Map<string, StayMapPoint[]>();
  for (const s of sortedSteps) {
    if (s.stepType !== "stay") continue;
    const step = s as StayStep;
    const main = destinationFromList(destinations, step.targetDestinationId);
    for (const int of step.stepIntervals) {
      if (int.intervalType !== "stay") continue;
      const si = int as StayStepInterval;
      const pinDestId = si.destinationId ?? step.targetDestinationId;
      const pinDest = destinationFromList(destinations, pinDestId);
      const pos = coordsFromDestination(pinDest);
      if (!pos) continue;

      const intervalDest = destinationFromList(destinations, si.destinationId);
      const placeLabel =
        (si.location ?? "").trim() ||
        (intervalDest?.location ?? "").trim() ||
        (main?.location ?? "").trim() ||
        (main?.title ?? "").trim() ||
        "—";
      const intervalTitle = (si.title ?? "").trim();
      const registryTitle = (intervalDest?.title ?? "").trim();
      const title =
        (si.destinationId && registryTitle
          ? registryTitle
          : intervalTitle || (step.title ?? "").trim() || (main?.title ?? "").trim() || "Stay") || "Stay";

      const row: StayMapPoint = {
        stepId: step.id,
        intervalId: si.id,
        title,
        position: pos,
        startTime: si.startTime,
        endTime: si.endTime,
        placeLabel,
      };
      const arr = m.get(pinDestId) ?? [];
      arr.push(row);
      m.set(pinDestId, arr);
    }
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }
  return m;
}

/** One entry per {@link Trip#destinations} row that has {@link Destination#coordinates} (view map pins). */
export type DestinationListPin = {
  destinationId: string;
  position: LatLng;
  title: string;
  placeLabel: string;
};

/** A Leaflet-ready pin for every destination in the list that already has saved coordinates. */
export function collectDestinationListPins(destinations: Destination[]): DestinationListPin[] {
  const out: DestinationListPin[] = [];
  for (const d of destinations) {
    const pos = coordsFromDestination(d);
    if (!pos) continue;
    out.push({
      destinationId: d.id,
      position: pos,
      title: (d.title || "Place").trim() || "Place",
      placeLabel: (d.location || d.description || d.title || "").trim() || "—",
    });
  }
  return out;
}

export type TransitMapEdge = {
  stepId: string;
  intervalId: string;
  title: string;
  from: LatLng;
  to: LatLng;
  startTime: string;
  endTime: string;
  fromPlaceLabel: string;
  toPlaceLabel: string;
  /** Drawn from previous/next step pins when this transit has no leg coordinates. */
  inferred?: boolean;
};

/** One map segment per transit interval that has both ends (with step-level fallback on first & last leg). */
export function transitIntervalsToMapEdges(
  step: TransitStep,
  destinations: Destination[]
): TransitMapEdge[] {
  const out: TransitMapEdge[] = [];
  let prevTo: LatLng | null = null;
  let firstTransitLeg = true;

  let lastTransitIdx = -1;
  for (let i = 0; i < step.stepIntervals.length; i++) {
    if (step.stepIntervals[i]!.intervalType === "transit") lastTransitIdx = i;
  }

  const fromStay = destinationFromList(destinations, step.fromStayId);
  const toStay = destinationFromList(destinations, step.toStayId);

  for (let idx = 0; idx < step.stepIntervals.length; idx++) {
    const interval = step.stepIntervals[idx]!;
    if (interval.intervalType !== "transit") continue;

    const isLastTransit = idx === lastTransitIdx;
    const next = step.stepIntervals[idx + 1];
    const nextLegStart =
      next?.intervalType === "transit"
        ? coordsFromDestination(
            destinationFromList(
              destinations,
              (next as TransitStepInterval).fromDestinationId
            )
          )
        : null;

    const legFrom = destinationFromList(destinations, interval.fromDestinationId);
    const legTo = destinationFromList(destinations, interval.toDestinationId);

    const legFromCoords = coordsFromDestination(legFrom);
    const fromStayCoords = coordsFromDestination(fromStay);
    let from: LatLng | null = null;
    let fromPlaceLabel = "—";
    if (legFromCoords) {
      from = legFromCoords;
      fromPlaceLabel = destinationDisplayLine(legFrom);
    } else if (firstTransitLeg && fromStayCoords) {
      from = fromStayCoords;
      fromPlaceLabel = destinationDisplayLine(fromStay);
    } else if (prevTo != null) {
      from = prevTo;
      fromPlaceLabel = TRANSIT_EDGE_LABEL_PRIOR_LEG;
    }

    const legToCoords = coordsFromDestination(legTo);
    const toStayCoords = coordsFromDestination(toStay);
    let to: LatLng | null = null;
    let toPlaceLabel = "—";
    if (legToCoords) {
      to = legToCoords;
      toPlaceLabel = destinationDisplayLine(legTo);
    } else if (!isLastTransit && nextLegStart) {
      to = nextLegStart;
      const nextInt = step.stepIntervals[idx + 1];
      if (nextInt?.intervalType === "transit") {
        const nd = destinationFromList(
          destinations,
          (nextInt as TransitStepInterval).fromDestinationId
        );
        toPlaceLabel = destinationDisplayLine(nd);
        if (toPlaceLabel === "—") toPlaceLabel = TRANSIT_EDGE_LABEL_NEXT_LEG;
      }
    } else if (isLastTransit && toStayCoords) {
      to = toStayCoords;
      toPlaceLabel = destinationDisplayLine(toStay);
    } else if (firstTransitLeg && toStayCoords) {
      to = toStayCoords;
      toPlaceLabel = destinationDisplayLine(toStay);
    }

    if (from && to) {
      const legTitle = (interval.title || step.title || "Transit").trim() || "Transit";
      out.push({
        stepId: step.id,
        intervalId: interval.id,
        title: legTitle,
        from,
        to,
        startTime: interval.startTime,
        endTime: interval.endTime,
        fromPlaceLabel,
        toPlaceLabel,
      });
      prevTo = to;
    } else {
      if (to) prevTo = to;
      else if (from) prevTo = from;
    }
    firstTransitLeg = false;
  }

  return out;
}

function stepMapExitPlaceLabel(step: TripStep | undefined, destinations: Destination[]): string {
  if (!step) return "—";
  if (step.stepType === "stay") {
    return destinationDisplayLine(
      destinationFromList(destinations, (step as StayStep).targetDestinationId)
    );
  }
  if (step.stepType === "activity") {
    const a = step as ActivityStep;
    return destinationDisplayLine(
      destinationFromList(destinations, a.destinationId) ??
        destinationFromList(destinations, a.targetDestinationId)
    );
  }
  if (step.stepType === "transit") {
    const tr = step as TransitStep;
    const edges = transitIntervalsToMapEdges(tr, destinations);
    if (edges.length > 0) return edges[edges.length - 1]!.toPlaceLabel;
    return destinationDisplayLine(destinationFromList(destinations, tr.toStayId));
  }
  return "—";
}

function stepMapEntryPlaceLabel(step: TripStep | undefined, destinations: Destination[]): string {
  if (!step) return "—";
  if (step.stepType === "stay") {
    return destinationDisplayLine(
      destinationFromList(destinations, (step as StayStep).targetDestinationId)
    );
  }
  if (step.stepType === "activity") {
    const a = step as ActivityStep;
    return destinationDisplayLine(
      destinationFromList(destinations, a.destinationId) ??
        destinationFromList(destinations, a.targetDestinationId)
    );
  }
  if (step.stepType === "transit") {
    const tr = step as TransitStep;
    const edges = transitIntervalsToMapEdges(tr, destinations);
    if (edges.length > 0) return edges[0]!.fromPlaceLabel;
    return destinationDisplayLine(destinationFromList(destinations, tr.fromStayId));
  }
  return "—";
}

/** Geographic “exit” after this step (for chaining lines across transit). */
function stepExitAnchor(step: TripStep, destinations: Destination[]): LatLng | null {
  if (step.stepType === "stay")
    return coordsFromDestination(destinationFromList(destinations, step.targetDestinationId));
  if (step.stepType === "activity") {
    const a = step;
    return (
      coordsFromDestination(destinationFromList(destinations, a.destinationId)) ??
      coordsFromDestination(destinationFromList(destinations, a.targetDestinationId))
    );
  }
  const t = step as TransitStep;
  const edges = transitIntervalsToMapEdges(t, destinations);
  if (edges.length > 0) return edges[edges.length - 1]!.to;
  return (
    coordsFromDestination(destinationFromList(destinations, t.toStayId)) ??
    coordsFromDestination(destinationFromList(destinations, t.fromStayId))
  );
}

/** Geographic “entry” at this step (for chaining lines across transit). */
function stepEntryAnchor(step: TripStep, destinations: Destination[]): LatLng | null {
  if (step.stepType === "stay")
    return coordsFromDestination(destinationFromList(destinations, step.targetDestinationId));
  if (step.stepType === "activity") {
    const a = step;
    return (
      coordsFromDestination(destinationFromList(destinations, a.destinationId)) ??
      coordsFromDestination(destinationFromList(destinations, a.targetDestinationId))
    );
  }
  const t = step as TransitStep;
  const edges = transitIntervalsToMapEdges(t, destinations);
  if (edges.length > 0) return edges[0]!.from;
  return (
    coordsFromDestination(destinationFromList(destinations, t.fromStayId)) ??
    coordsFromDestination(destinationFromList(destinations, t.toStayId))
  );
}

function walkExitAnchor(steps: TripStep[], startIndex: number, destinations: Destination[]): LatLng | null {
  for (let j = startIndex; j >= 0; j--) {
    const c = stepExitAnchor(steps[j]!, destinations);
    if (c) return c;
  }
  return null;
}

function walkEntryAnchor(steps: TripStep[], startIndex: number, destinations: Destination[]): LatLng | null {
  for (let j = startIndex; j < steps.length; j++) {
    const c = stepEntryAnchor(steps[j]!, destinations);
    if (c) return c;
  }
  return null;
}

function sameLatLng(a: LatLng, b: LatLng): boolean {
  return a.lat === b.lat && a.lng === b.lng;
}

/** Transit legs on the map come only from {@link TransitStep#stepIntervals} rows with `intervalType: "transit"` (see {@link transitIntervalsToMapEdges}). */
export function collectTransitMapEdges(
  sortedSteps: TripStep[],
  destinations: Destination[]
): TransitMapEdge[] {
  const out: TransitMapEdge[] = [];
  for (const s of sortedSteps) {
    if (s.stepType !== "transit") continue;
    out.push(...transitIntervalsToMapEdges(s as TransitStep, destinations));
  }
  return out;
}

/** Initial geographic bearing from A to B in degrees (0 = north, 90 = east). */
export function bearingDegreesNorth(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function interpolateLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

/**
 * Primary map anchor for the dashboard “current” step (stay / transit / activity).
 * Pass `sortedSteps` so a transit step with no leg coords can still center on an inferred connector.
 */
export function focusStepLatLng(
  focus: CurrentStepFocus,
  sortedSteps: TripStep[] | undefined,
  destinations: Destination[]
): LatLng | null {
  if (focus.kind === "none") return null;
  const s = focus.step;
  if (s.stepType === "stay") {
    const st = s as StayStep;
    const area = st.areaCenterDestinationId
      ? coordsFromDestination(destinationFromList(destinations, st.areaCenterDestinationId))
      : null;
    return (
      area ??
      coordsFromDestination(destinationFromList(destinations, st.targetDestinationId))
    );
  }
  if (s.stepType === "activity") {
    return (
      coordsFromDestination(destinationFromList(destinations, s.destinationId)) ??
      coordsFromDestination(destinationFromList(destinations, s.targetDestinationId))
    );
  }
  const t = s as TransitStep;
  const edges = transitIntervalsToMapEdges(t, destinations);
  const first = edges[0];
  if (first) return interpolateLatLng(first.from, first.to, 0.5);
  if (sortedSteps?.length) {
    const idx = sortedSteps.findIndex((x) => x.id === t.id);
    if (idx >= 0) {
      const from = walkExitAnchor(sortedSteps, idx - 1, destinations);
      const to = walkEntryAnchor(sortedSteps, idx + 1, destinations);
      if (from && to && !sameLatLng(from, to)) return interpolateLatLng(from, to, 0.5);
    }
  }
  return (
    coordsFromDestination(destinationFromList(destinations, t.fromStayId)) ??
    coordsFromDestination(destinationFromList(destinations, t.toStayId)) ??
    null
  );
}
