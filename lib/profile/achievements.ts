import type { Trip } from "@/lib/types/trip";
import { tripCountries } from "@/lib/trip/tripCentroid";
import { coordsFromDestination } from "@/lib/tripDestinationGeo";
import { haversineDistanceMeters } from "@/lib/tripDestinationGeo";

export interface TravelStats {
  trips: number;
  daysTraveled: number;
  upcomingCount: number;
  countries: string[];
  /** Sum of point-to-point distances between consecutive destinations across all trips, meters. */
  distanceMeters: number;
}

export function computeTravelStats(trips: Trip[]): TravelStats {
  const now = Date.now();
  let days = 0;
  let upcoming = 0;
  let distance = 0;
  const countrySet = new Set<string>();
  for (const trip of trips) {
    if (Number.isFinite(Date.parse(trip.startDate)) && Number.isFinite(Date.parse(trip.endDate))) {
      const start = Date.parse(trip.startDate);
      const end = Date.parse(trip.endDate);
      const dur = Math.max(0, end - start);
      // Only count completed days for "days traveled"; future trips counted in upcoming.
      if (now > end) {
        days += Math.round(dur / (24 * 3600 * 1000));
      } else if (now < start) {
        upcoming += 1;
      } else {
        days += Math.round((now - start) / (24 * 3600 * 1000));
      }
    }
    for (const c of tripCountries(trip)) countrySet.add(c);
    let prev: { lat: number; lng: number } | null = null;
    for (const dest of trip.destinations ?? []) {
      const c = coordsFromDestination(dest);
      if (!c) continue;
      if (prev) distance += haversineDistanceMeters(prev, c);
      prev = c;
    }
  }
  return {
    trips: trips.length,
    daysTraveled: days,
    upcomingCount: upcoming,
    countries: Array.from(countrySet).sort(),
    distanceMeters: Math.round(distance),
  };
}

export interface Achievement {
  id: string;
  emoji: string;
  title: string;
  description: string;
  unlocked: boolean;
}

export function deriveAchievements(stats: TravelStats): Achievement[] {
  return [
    {
      id: "first-trip",
      emoji: "✈️",
      title: "Departure",
      description: "Plan your first trip.",
      unlocked: stats.trips >= 1,
    },
    {
      id: "five-trips",
      emoji: "🧳",
      title: "Frequent flyer",
      description: "Plan 5 trips.",
      unlocked: stats.trips >= 5,
    },
    {
      id: "ten-countries",
      emoji: "🌍",
      title: "Globetrotter",
      description: "Visit 10 distinct countries.",
      unlocked: stats.countries.length >= 10,
    },
    {
      id: "thirty-days",
      emoji: "🗓",
      title: "Long-hauler",
      description: "Spend 30 days on the road.",
      unlocked: stats.daysTraveled >= 30,
    },
    {
      id: "ten-thousand-km",
      emoji: "🛰",
      title: "10,000 km club",
      description: "Cover 10,000 km of route lines.",
      unlocked: stats.distanceMeters >= 10_000_000,
    },
  ];
}
