import type { ActivityType, TransitType, TripStep } from "@/lib/types/trip";

export function transitTypeEmoji(transitType: TransitType): string {
  switch (transitType) {
    case "flight":
      return "✈️";
    case "ferry":
      return "⛴️";
    case "speed_boat":
      return "🚤";
    case "minivan":
      return "🚐";
    case "taxi":
      return "🚕";
    case "train":
      return "🚆";
    case "bus":
      return "🚌";
    case "walk":
      return "🚶";
    case "rental_car":
      return "🚗";
    case "other":
      return "🚏";
  }
}

function activityTypeEmoji(activityType: ActivityType): string {
  switch (activityType) {
    case "tour":
      return "🧭";
    case "restaurant":
      return "🍽️";
    case "snorkeling":
    case "diving":
      return "🤿";
    case "hike":
      return "🥾";
    case "spa":
      return "💆";
    case "beach":
      return "🏖️";
    case "shopping":
      return "🛍️";
    case "free_time":
      return "☕";
    case "nightlife":
      return "🌃";
    case "other":
      return "📍";
  }
}

/** Visual marker for a step interval row (stay / transit / activity segment). */
export function stepIntervalEmoji(interval: TripStep["stepIntervals"][number]): string {
  switch (interval.intervalType) {
    case "stay":
      return "🏨";
    case "transit":
      return transitTypeEmoji(interval.transitType);
    case "activity":
      return activityTypeEmoji(interval.activityType);
    default:
      return "•";
  }
}
