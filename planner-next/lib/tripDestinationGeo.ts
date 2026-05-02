/**
 * Pure destination ↔ map helpers (no Leaflet). Safe to import from Server Components and shared UI.
 */
import type { Destination } from "@/lib/types/trip";

export type LatLng = { lat: number; lng: number };

export function coordsFromDestination(d: Destination | undefined | null): LatLng | null {
  if (!d?.coordinates) return null;
  const { lat, lon } = d.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lng: lon };
}

export function destinationHasMapCoordinates(d: Destination | undefined | null): boolean {
  return coordsFromDestination(d) !== null;
}
