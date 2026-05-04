/**
 * Pure destination ↔ map helpers (no Leaflet). Safe to import from Server Components and shared UI.
 */
import type { Destination } from "@/lib/types/trip";

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6371000;

/** Great-circle distance between two WGS84 points in meters. */
export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);
  const h =
    sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function coordsFromDestination(d: Destination | undefined | null): LatLng | null {
  if (!d?.coordinates) return null;
  const { lat, lon } = d.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lng: lon };
}

export function destinationHasMapCoordinates(d: Destination | undefined | null): boolean {
  return coordsFromDestination(d) !== null;
}
