import type { Coordinates, Trip } from "@/lib/types/trip";

/** Average of all destination coordinates, when at least one is geocoded. */
export function tripDestinationCentroid(trip: Trip | null | undefined): Coordinates | null {
  if (!trip) return null;
  let lat = 0;
  let lon = 0;
  let count = 0;
  for (const d of trip.destinations ?? []) {
    if (d.coordinates && Number.isFinite(d.coordinates.lat) && Number.isFinite(d.coordinates.lon)) {
      lat += d.coordinates.lat;
      lon += d.coordinates.lon;
      count += 1;
    }
  }
  if (count === 0) return null;
  return { lat: lat / count, lon: lon / count };
}

/** Distinct country names extracted from destination location strings. Heuristic — last comma segment. */
export function tripCountries(trip: Trip | null | undefined): string[] {
  if (!trip) return [];
  const set = new Set<string>();
  for (const d of trip.destinations ?? []) {
    const tokens = (d.location || d.description || "").split(",").map((s) => s.trim());
    if (tokens.length > 0) {
      const last = tokens[tokens.length - 1];
      if (last) set.add(last);
    }
  }
  return Array.from(set);
}
