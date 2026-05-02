import L from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import { coordsFromDestination, type LatLng } from "@/lib/tripDestinationGeo";
import { destinationFromList } from "@/lib/tripDestinationRegistry";
import type { CurrentStepFocus } from "@/lib/tripViewPhase";
import type {
  Destination,
  StayStep,
  StayStepInterval,
  TransitStep,
  TransitStepInterval,
  TripStep,
} from "@/lib/types/trip";

export type { LatLng } from "@/lib/tripDestinationGeo";
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

/** One map pin per stay interval (interval coords, else interval registry row, else step default). */
export function collectStayMapPoints(sortedSteps: TripStep[], destinations: Destination[]): StayMapPoint[] {
  const out: StayMapPoint[] = [];
  for (const s of sortedSteps) {
    if (s.stepType !== "stay") continue;
    const step = s as StayStep;
    const main = destinationFromList(destinations, step.targetDestinationId);
    const fallbackPos = coordsFromDestination(main);
    if (!fallbackPos && step.stepIntervals.length === 0) continue;

    for (const int of step.stepIntervals) {
      if (int.intervalType !== "stay") continue;
      const si = int as StayStepInterval;
      const intervalDest = destinationFromList(destinations, si.destinationId);
      const pos =
        coordsFromStayInterval(si) ??
        coordsFromDestination(intervalDest) ??
        fallbackPos;
      if (!pos) continue;
      const placeLabel =
        (si.location ?? "").trim() ||
        (intervalDest?.location ?? "").trim() ||
        (main?.location ?? "").trim() ||
        (main?.title ?? "").trim() ||
        "—";
      const title =
        (si.title || step.title || main?.title || "Stay").trim() || "Stay";
      out.push({
        stepId: step.id,
        intervalId: si.id,
        title,
        position: pos,
        startTime: si.startTime,
        endTime: si.endTime,
        placeLabel,
      });
    }
  }
  return out;
}

export type StayCluster = {
  centroid: LatLng;
  stays: StayMapPoint[];
};

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

/**
 * Group stays that overlap on screen within `clusterPx` (layer pixels). Lower map zoom uses a
 * larger effective radius so nearby stays merge when zoomed out; zoom in to split clusters.
 */
export function clusterStayPointsScreen(
  map: LeafletMap,
  stays: StayMapPoint[],
  clusterPx: number
): StayCluster[] {
  if (stays.length === 0) return [];
  const n = stays.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  }
  function union(i: number, j: number) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }

  const pts = stays.map((s) =>
    map.latLngToLayerPoint(L.latLng(s.position.lat, s.position.lng))
  );

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (pts[i].distanceTo(pts[j]) <= clusterPx) union(i, j);
    }
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = byRoot.get(r) ?? [];
    arr.push(i);
    byRoot.set(r, arr);
  }

  const clusters: StayCluster[] = [];
  for (const indices of byRoot.values()) {
    const groupStays = indices.map((i) => stays[i]);
    groupStays.sort((a, b) => a.startTime.localeCompare(b.startTime));
    let sumLat = 0;
    let sumLng = 0;
    for (const st of groupStays) {
      sumLat += st.position.lat;
      sumLng += st.position.lng;
    }
    clusters.push({
      centroid: {
        lat: sumLat / groupStays.length,
        lng: sumLng / groupStays.length,
      },
      stays: groupStays,
    });
  }
  clusters.sort((a, b) => a.stays[0].startTime.localeCompare(b.stays[0].startTime));
  return clusters;
}

/** Layer-pixel merge distance from zoom (smaller zoom level ⇒ larger px ⇒ more grouping). */
export function stayClusterPixelRadius(zoom: number): number {
  return Math.min(52, Math.max(14, 62 - zoom * 2.75));
}

export type TransitMapEdge = {
  stepId: string;
  intervalId: string;
  title: string;
  from: LatLng;
  to: LatLng;
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

    const from: LatLng | null =
      coordsFromDestination(legFrom) ??
      (firstTransitLeg ? coordsFromDestination(fromStay) : null) ??
      prevTo;
    const to: LatLng | null =
      coordsFromDestination(legTo) ??
      (!isLastTransit ? nextLegStart : null) ??
      (isLastTransit ? coordsFromDestination(toStay) : null) ??
      (firstTransitLeg ? coordsFromDestination(toStay) : null);

    if (from && to) {
      const legTitle = (interval.title || step.title || "Transit").trim() || "Transit";
      out.push({
        stepId: step.id,
        intervalId: interval.id,
        title: legTitle,
        from,
        to,
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

export function collectTransitMapEdges(
  sortedSteps: TripStep[],
  destinations: Destination[]
): TransitMapEdge[] {
  const out: TransitMapEdge[] = [];
  for (let i = 0; i < sortedSteps.length; i++) {
    const s = sortedSteps[i]!;
    if (s.stepType !== "transit") continue;
    const explicit = transitIntervalsToMapEdges(s, destinations);
    if (explicit.length > 0) {
      out.push(...explicit);
      continue;
    }
    const from = walkExitAnchor(sortedSteps, i - 1, destinations);
    const to = walkEntryAnchor(sortedSteps, i + 1, destinations);
    if (!from || !to || sameLatLng(from, to)) continue;
    out.push({
      stepId: s.id,
      intervalId: `inferred-${s.id}`,
      title: (s.title || "Transit").trim() || "Transit",
      from,
      to,
      inferred: true,
    });
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
  if (s.stepType === "stay")
    return coordsFromDestination(destinationFromList(destinations, s.targetDestinationId));
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
