import type { Trip, TripStep } from "@/lib/types/trip";

export interface TripBudgetTotals {
  transport: number;
  food: number;
  activities: number;
  other: number;
  hotels: number;
  total: number;
}

export function sumHotelCosts(step: TripStep): number {
  return step.hotels.reduce((acc, h) => acc + (Number.isFinite(h.cost) ? h.cost : 0), 0);
}

export function computeBudgetTotals(trip: Trip): TripBudgetTotals {
  let transport = 0;
  let food = 0;
  let activities = 0;
  let other = 0;
  let hotels = 0;
  for (const s of trip.steps) {
    transport += s.transportCost || 0;
    food += s.foodCost || 0;
    activities += s.activitiesCost || 0;
    other += s.otherCost || 0;
    hotels += sumHotelCosts(s);
  }
  const total = transport + food + activities + other + hotels;
  return { transport, food, activities, other, hotels, total };
}
