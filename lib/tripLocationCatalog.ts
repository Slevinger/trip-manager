import { destinationFromList } from "@/lib/tripDestinationRegistry";
import { sortTripStepsByStartTime } from "@/lib/tripStepSort";
import type { Destination, StayStep, StayStepInterval, TripStep } from "@/lib/types/trip";

/** Known place on the trip for autocomplete (Photon is still used for new places). */
export type TripPlacePick = {
  id: string;
  /** Registry row when this pick is a saved {@link Destination}. */
  destinationId?: string;
  /** Value written into the field / used for geocode (usually full address line). */
  label: string;
  subtitle?: string;
  /** Place name / hotel title — shown as the main line when different from {@link label}. */
  headline?: string;
  lat?: number;
  lng?: number;
};

/** One stay block: center row first, then every other place used on that stay. */
export type StayPlacePickGroup = {
  stepId: string;
  stayLabel: string;
  centerPick: TripPlacePick;
  memberPicks: TripPlacePick[];
};

/** Stays grouped by step for pickers; other step destinations follow (same registry, one list). */
export type TripGroupedPlacePicks = {
  stayGroups: StayPlacePickGroup[];
  otherPicks: TripPlacePick[];
};

function pushTripPick(
  map: Map<string, TripPlacePick>,
  labelRaw: string,
  subtitle: string,
  opt: {
    headline?: string;
    lat?: number;
    lng?: number;
    /** When set, pick resolves to this registry id (see {@link TripPlacePick#destinationId}). */
    registryDestinationId?: string;
    /** Stable list key when this is not a registry row (e.g. interval-only pin). */
    syntheticId?: string;
  }
) {
  const label = (labelRaw ?? "").trim();
  if (!label) return;
  const key = label.toLowerCase();
  if (map.has(key)) return;
  const id =
    opt.registryDestinationId ?? opt.syntheticId ?? `trip-${map.size}-${key.slice(0, 20)}`;
  map.set(key, {
    id,
    ...(opt.registryDestinationId ? { destinationId: opt.registryDestinationId } : {}),
    label,
    subtitle,
    ...(opt.headline ? { headline: opt.headline } : {}),
    ...(opt.lat != null && opt.lng != null ? { lat: opt.lat, lng: opt.lng } : {}),
  });
}

function addDestination(map: Map<string, TripPlacePick>, d: Destination | undefined, subtitle: string) {
  if (!d) return;
  const addr = (d.location ?? "").trim();
  const title = (d.title ?? "").trim();
  const primary = addr || title;
  const headline = addr && title && title !== addr ? title : undefined;
  const lat = d.coordinates?.lat;
  const lon = d.coordinates?.lon;
  pushTripPick(map, primary, subtitle, {
    registryDestinationId: d.id,
    headline,
    ...(lat != null && lon != null ? { lat, lng: lon } : {}),
  });
}

function pickFromDestinationRow(d: Destination | undefined, subtitle: string): TripPlacePick | null {
  if (!d) return null;
  const addr = (d.location ?? "").trim();
  const title = (d.title ?? "").trim();
  const primary = addr || title;
  const label = primary || "—";
  const headline = addr && title && title !== addr ? title : undefined;
  const lat = d.coordinates?.lat;
  const lon = d.coordinates?.lon;
  return {
    id: d.id,
    destinationId: d.id,
    label,
    subtitle,
    ...(headline ? { headline } : {}),
    ...(lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lng: lon } : {}),
  };
}

function pickFromStayIntervalMember(
  int: StayStepInterval,
  destinations: Destination[],
  stayTitle: string
): TripPlacePick | null {
  if (int.intervalType !== "stay") return null;
  const loc = (int.location ?? "").trim();
  const c = int.coordinates;
  const slot = int.destinationId ? destinationFromList(destinations, int.destinationId) : undefined;
  if (slot && !loc) {
    return pickFromDestinationRow(slot, stayTitle);
  }
  if (!loc && !slot) return null;
  if (slot && loc) {
    return pickFromDestinationRow(slot, stayTitle);
  }
  const hl = int.title.trim() && int.title.trim() !== loc ? int.title.trim() : undefined;
  return {
    id: `synth-stay-${int.id}`,
    label: loc,
    subtitle: stayTitle,
    ...(hl ? { headline: hl } : {}),
    ...(c && Number.isFinite(c.lat) && Number.isFinite(c.lon) ? { lat: c.lat, lng: c.lon } : {}),
  };
}

/**
 * Stays: each group lists **area center** (if set) else **main target**, then all other destinations
 * used on that stay. Non-stay steps are flattened into `otherPicks` (deduped by label), excluding
 * any registry id already shown under a stay (so the same hotel does not appear again under transit
 * / activities).
 */
export function collectStayGroupedTripPlacePicks(
  steps: TripStep[],
  destinations: Destination[]
): TripGroupedPlacePicks {
  const ordered = sortTripStepsByStartTime(steps);
  const stayGroups: StayPlacePickGroup[] = [];

  for (const s of ordered) {
    if (s.stepType !== "stay") continue;
    const stay = s as StayStep;
    const stayLabel = (stay.title || "Stay").trim() || "Stay";
    const targetD = destinationFromList(destinations, stay.targetDestinationId);
    const areaD = stay.areaCenterDestinationId
      ? destinationFromList(destinations, stay.areaCenterDestinationId)
      : undefined;

    const centerDest = areaD ?? targetD;
    if (!centerDest) continue;

    const centerSubtitle = areaD ? `${stayLabel} · area center` : stayLabel;
    const centerPick = pickFromDestinationRow(centerDest, centerSubtitle);
    if (!centerPick) continue;

    const usedIds = new Set<string>([centerPick.id]);
    const members: TripPlacePick[] = [];

    function pushMember(p: TripPlacePick | null) {
      if (!p || usedIds.has(p.id)) return;
      usedIds.add(p.id);
      members.push(p);
    }

    if (targetD && targetD.id !== centerDest.id) {
      pushMember(pickFromDestinationRow(targetD, `${stayLabel} · main`));
    }
    if (areaD && areaD.id !== centerDest.id) {
      pushMember(pickFromDestinationRow(areaD, `${stayLabel} · area center`));
    }

    for (const int of stay.stepIntervals) {
      if (int.intervalType !== "stay") continue;
      pushMember(pickFromStayIntervalMember(int, destinations, stayLabel));
    }

    stayGroups.push({
      stepId: stay.id,
      stayLabel,
      centerPick,
      memberPicks: members,
    });
  }

  const registryOnStayPicks = new Set<string>();
  for (const g of stayGroups) {
    if (g.centerPick.destinationId) registryOnStayPicks.add(g.centerPick.destinationId);
    for (const m of g.memberPicks) {
      if (m.destinationId) registryOnStayPicks.add(m.destinationId);
    }
  }

  const otherMap = new Map<string, TripPlacePick>();
  for (const s of ordered) {
    if (s.stepType === "stay") continue;
    const stepLine = (s.title || "").trim() || "—";
    if (s.stepType === "transit") {
      addDestination(otherMap, destinationFromList(destinations, s.fromStayId), stepLine);
      addDestination(otherMap, destinationFromList(destinations, s.toStayId), stepLine);
      addDestination(otherMap, destinationFromList(destinations, s.targetDestinationId), stepLine);
      for (const int of s.stepIntervals) {
        if (int.intervalType !== "transit") continue;
        const legLine = (int.title || "").trim() || stepLine;
        addDestination(otherMap, destinationFromList(destinations, int.fromDestinationId), legLine);
        addDestination(otherMap, destinationFromList(destinations, int.toDestinationId), legLine);
      }
    } else {
      addDestination(otherMap, destinationFromList(destinations, s.destinationId), stepLine);
      addDestination(otherMap, destinationFromList(destinations, s.targetDestinationId), stepLine);
      for (const int of s.stepIntervals) {
        if (int.intervalType === "activity" && int.destinationId) {
          addDestination(otherMap, destinationFromList(destinations, int.destinationId), stepLine);
        }
      }
    }
  }

  const otherPicks = Array.from(otherMap.values()).filter(
    (p) => !p.destinationId || !registryOnStayPicks.has(p.destinationId)
  );

  return { stayGroups, otherPicks };
}

/**
 * Deduped list of place labels from all steps (stays, stay intervals, transit from/to and legs,
 * activities) for address autocomplete.
 */
export function collectTripPlacePicks(steps: TripStep[], destinations: Destination[]): TripPlacePick[] {
  const map = new Map<string, TripPlacePick>();
  const ordered = sortTripStepsByStartTime(steps);

  for (const s of ordered) {
    if (s.stepType === "stay") {
      const stayLine = (s.title || "").trim() || "—";
      addDestination(map, destinationFromList(destinations, s.targetDestinationId), stayLine);
      if (s.areaCenterDestinationId) {
        addDestination(
          map,
          destinationFromList(destinations, s.areaCenterDestinationId),
          `${stayLine} · area center`
        );
      }
      for (const int of s.stepIntervals) {
        if (int.intervalType !== "stay") continue;
        const loc = (int.location ?? "").trim();
        const c = int.coordinates;
        const slot = int.destinationId
          ? destinationFromList(destinations, int.destinationId)
          : undefined;
        if (slot && !loc) {
          addDestination(map, slot, stayLine);
          continue;
        }
        if (!loc) continue;
        if (slot) {
          addDestination(map, slot, stayLine);
        } else {
          const hl =
            int.title.trim() && int.title.trim() !== loc ? int.title.trim() : undefined;
          pushTripPick(map, loc, stayLine, {
            syntheticId: int.id,
            headline: hl,
            ...(c ? { lat: c.lat, lng: c.lon } : {}),
          });
        }
      }
    } else if (s.stepType === "transit") {
      const transitLine = (s.title || "").trim() || "—";
      addDestination(map, destinationFromList(destinations, s.fromStayId), transitLine);
      addDestination(map, destinationFromList(destinations, s.toStayId), transitLine);
      addDestination(map, destinationFromList(destinations, s.targetDestinationId), transitLine);
      for (const int of s.stepIntervals) {
        if (int.intervalType === "transit") {
          const legLine = (int.title || "").trim() || transitLine;
          addDestination(map, destinationFromList(destinations, int.fromDestinationId), legLine);
          addDestination(map, destinationFromList(destinations, int.toDestinationId), legLine);
        }
      }
    } else if (s.stepType === "activity") {
      const activityLine = (s.title || "").trim() || "—";
      addDestination(map, destinationFromList(destinations, s.destinationId), activityLine);
      addDestination(map, destinationFromList(destinations, s.targetDestinationId), activityLine);
      for (const int of s.stepIntervals) {
        if (int.intervalType === "activity" && int.destinationId) {
          addDestination(map, destinationFromList(destinations, int.destinationId), activityLine);
        }
      }
    }
  }

  return Array.from(map.values());
}
