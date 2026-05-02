import { destinationFromList } from "@/lib/tripDestinationRegistry";
import { sortTripStepsByStartTime } from "@/lib/tripStepSort";
import type { Destination, TripStep } from "@/lib/types/trip";

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

/**
 * Deduped list of place labels from all steps (stays, stay intervals, transit from/to and legs,
 * activities) for address autocomplete.
 */
export function collectTripPlacePicks(steps: TripStep[], destinations: Destination[]): TripPlacePick[] {
  const map = new Map<string, TripPlacePick>();
  const ordered = sortTripStepsByStartTime(steps);

  for (const s of ordered) {
    if (s.stepType === "stay") {
      addDestination(
        map,
        destinationFromList(destinations, s.targetDestinationId),
        `Stay · ${(s.title || "Untitled").trim() || "Stay"}`
      );
      for (const int of s.stepIntervals) {
        if (int.intervalType !== "stay") continue;
        const loc = (int.location ?? "").trim();
        const c = int.coordinates;
        const slot = int.destinationId
          ? destinationFromList(destinations, int.destinationId)
          : undefined;
        if (slot && !loc) {
          addDestination(map, slot, `Stay interval · ${(s.title || "Stay").trim()}`);
          continue;
        }
        if (!loc) continue;
        if (slot) {
          addDestination(map, slot, `Stay interval · ${(s.title || "Stay").trim()}`);
        } else {
          const hl =
            int.title.trim() && int.title.trim() !== loc ? int.title.trim() : undefined;
          pushTripPick(map, loc, `Stay interval · ${(s.title || "Stay").trim()}`, {
            syntheticId: int.id,
            headline: hl,
            ...(c ? { lat: c.lat, lng: c.lon } : {}),
          });
        }
      }
    } else if (s.stepType === "transit") {
      addDestination(
        map,
        destinationFromList(destinations, s.fromStayId),
        `Transit from · ${(s.title || "Transit").trim()}`
      );
      addDestination(
        map,
        destinationFromList(destinations, s.toStayId),
        `Transit to · ${(s.title || "Transit").trim()}`
      );
      addDestination(
        map,
        destinationFromList(destinations, s.targetDestinationId),
        `Transit · ${(s.title || "Transit").trim()}`
      );
      for (const int of s.stepIntervals) {
        if (int.intervalType === "transit") {
          addDestination(
            map,
            destinationFromList(destinations, int.fromDestinationId),
            `Transit leg · ${int.title.trim() || "Leg"}`
          );
          addDestination(
            map,
            destinationFromList(destinations, int.toDestinationId),
            `Transit leg · ${int.title.trim() || "Leg"}`
          );
        }
      }
    } else if (s.stepType === "activity") {
      addDestination(
        map,
        destinationFromList(destinations, s.destinationId),
        `Activity · ${(s.title || "Activity").trim()}`
      );
      addDestination(
        map,
        destinationFromList(destinations, s.targetDestinationId),
        `Activity · ${(s.title || "Activity").trim()}`
      );
      for (const int of s.stepIntervals) {
        if (int.intervalType === "activity" && int.destinationId) {
          addDestination(
            map,
            destinationFromList(destinations, int.destinationId),
            `Activity slot · ${(s.title || "Activity").trim()}`
          );
        }
      }
    }
  }

  return Array.from(map.values());
}
