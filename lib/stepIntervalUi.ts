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
    case "museum":
    case "gallery":
    case "historic_site":
      return "🏛️";
    case "theater":
      return "🎭";
    case "concert":
      return "🎵";
    case "festival":
      return "🎪";
    case "market":
      return "🛒";
    case "shopping":
      return "🛍️";
    case "nightlife":
      return "🌃";
    case "beach":
      return "🏖️";
    case "snorkeling":
    case "diving":
      return "🤿";
    case "surfing":
      return "🏄";
    case "kayaking":
      return "🛶";
    case "sailing":
      return "⛵";
    case "hike":
      return "🥾";
    case "climbing":
      return "🧗";
    case "cycling":
      return "🚴";
    case "scenic_drive":
      return "🛣️";
    case "viewpoint":
      return "🔭";
    case "photography_walk":
      return "📷";
    case "cooking_class":
      return "👩‍🍳";
    case "wine_tasting":
      return "🍷";
    case "coffee_tour":
      return "☕";
    case "spa":
      return "💆";
    case "hot_spring":
      return "♨️";
    case "religious_site":
      return "⛪";
    case "national_park":
      return "🏞️";
    case "wildlife":
    case "zoo":
      return "🦁";
    case "aquarium":
      return "🐠";
    case "theme_park":
      return "🎢";
    case "free_time":
      return "🕐";
    case "volunteering":
      return "🤝";
    case "workshop":
      return "🔧";
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
