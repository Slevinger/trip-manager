import type { Trip } from "@/lib/types/trip";
import {
  collectHotelDateWarnings,
  type HotelDateWarning,
} from "@/lib/timeline/hotelsAndDates";
import {
  collectTimeIntelligenceWarnings,
  type TimeIntelWarning,
} from "@/lib/timeline/timeIntelligence";

export type AggregatedWarnings = {
  time: TimeIntelWarning[];
  hotel: HotelDateWarning[];
};

export function collectAllWarnings(trip: Trip): AggregatedWarnings {
  const time = collectTimeIntelligenceWarnings(trip);
  const hotel: HotelDateWarning[] = [];
  for (const s of trip.steps) {
    hotel.push(...collectHotelDateWarnings(s));
  }
  return { time, hotel };
}
