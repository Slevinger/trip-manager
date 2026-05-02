import type { ActivityType, StayType, TransitType } from "@/lib/types/trip";

export const STAY_TYPES: StayType[] = [
  "hotel",
  "resort",
  "b&b",
  "bungalow",
  "airbnb",
  "villa",
  "hostel",
  "other",
];

export const TRANSIT_TYPES: TransitType[] = [
  "flight",
  "ferry",
  "speed_boat",
  "minivan",
  "taxi",
  "train",
  "bus",
  "walk",
  "rental_car",
  "other",
];

export const ACTIVITY_TYPES: ActivityType[] = [
  "tour",
  "restaurant",
  "snorkeling",
  "diving",
  "hike",
  "spa",
  "beach",
  "shopping",
  "free_time",
  "nightlife",
  "other",
];
