import type { Hotel, TripStep } from "@/lib/types/trip";
import {
  diffNightsInclusive,
  instantFromParts,
  maxTripDateTime,
  minTripDateTime,
  parseDdMmYyyyCalendarDate,
  type TripDateTimeParts,
} from "@/lib/timeline/dates";
import {
  applyTransitDurationToEnd,
  normalizeTransitStepDurationFields,
  transitStepDurationLabel,
} from "@/lib/timeline/transitDuration";

export type HotelDateWarningCode =
  | "no_hotels_but_nights"
  | "hotels_not_covering"
  | "hotels_exceed_range"
  | "missing_checkin"
  | "missing_checkout"
  | "checkout_before_checkin";

export interface HotelDateWarning {
  code: HotelDateWarningCode;
  stepId: string;
  hotelId?: string;
}

function hotelCheckinParts(h: Hotel): TripDateTimeParts {
  return { date: h.checkinDate.trim(), time: h.checkinTime.trim() };
}

function hotelCheckoutParts(h: Hotel): TripDateTimeParts {
  return { date: h.checkoutDate.trim(), time: h.checkoutTime.trim() };
}

function earliestHotelCheckin(hotels: Hotel[]): TripDateTimeParts | null {
  const parts = hotels
    .map((h) => hotelCheckinParts(h))
    .filter((p) => p.date);
  if (!parts.length) return null;
  return parts.reduce((acc, cur) => minTripDateTime(acc, cur));
}

function latestHotelCheckout(hotels: Hotel[]): TripDateTimeParts | null {
  const parts = hotels
    .map((h) => hotelCheckoutParts(h))
    .filter((p) => p.date);
  if (!parts.length) return null;
  return parts.reduce((acc, cur) => maxTripDateTime(acc, cur));
}

export function effectiveStepStartParts(step: TripStep): TripDateTimeParts {
  if (step.startDate.trim()) {
    return { date: step.startDate.trim(), time: step.startTime.trim() };
  }
  if (step.type === "stay") {
    return earliestHotelCheckin(step.hotels) ?? { date: "", time: "" };
  }
  return { date: "", time: "" };
}

export function effectiveStepEndParts(step: TripStep): TripDateTimeParts {
  if (step.endDateOpen && step.type === "stay") {
    const fromHotels = latestHotelCheckout(step.hotels);
    if (fromHotels?.date) return fromHotels;
  }
  return { date: step.endDate.trim(), time: step.endTime.trim() };
}

/** Recompute nights from effective start/end (inclusive nights between calendar days). Transit has no nights. */
export function computeNightsForStep(step: TripStep): number {
  if (step.type === "transit") return 0;
  const start = effectiveStepStartParts(step);
  const end = effectiveStepEndParts(step);
  const ds = parseDdMmYyyyCalendarDate(start.date);
  const de = parseDdMmYyyyCalendarDate(end.date);
  if (!ds || !de) return 0;
  return diffNightsInclusive(ds, de);
}

/** When endDateOpen and hotel checkout changes, end should follow latest checkout. */
export function applyOpenEndDateFromHotels<T extends TripStep>(step: T): T {
  if (!step.endDateOpen || step.type !== "stay") return step;
  const latest = latestHotelCheckout(step.hotels);
  if (!latest?.date) return { ...step, endDate: "", endTime: "" } as T;
  return { ...step, endDate: latest.date, endTime: latest.time } as T;
}

export function applyTransitEndFromArrivals<T extends TripStep>(step: T): T {
  if (step.type !== "transit") return step;
  return applyTransitDurationToEnd(
    normalizeTransitStepDurationFields(step)
  ) as T;
}

/** Human-readable transit length from day/hour/minute fields (and start). */
export function transitStepDurationFromArrivals(step: TripStep): string {
  return transitStepDurationLabel(step);
}

/** Persisted step fields aligned with hotel timeline rules. */
export function syncStepWithHotels(step: TripStep): TripStep {
  const withEnd = applyOpenEndDateFromHotels(step);
  if (withEnd.type !== "transit") {
    return { ...withEnd, nights: computeNightsForStep(withEnd) };
  }
  const withTransitEnd = applyTransitEndFromArrivals(withEnd);
  return {
    ...withTransitEnd,
    nights: 0,
    duration: transitStepDurationLabel(withTransitEnd),
  };
}

export function collectHotelDateWarnings(step: TripStep): HotelDateWarning[] {
  if (step.type !== "stay") return [];
  const warnings: HotelDateWarning[] = [];
  const effStart = effectiveStepStartParts(step);
  const effEnd = effectiveStepEndParts(step);
  const nights = computeNightsForStep(step);

  if (step.hotels.length === 0 && nights > 0) {
    warnings.push({ code: "no_hotels_but_nights", stepId: step.id });
  }

  for (const h of step.hotels) {
    if (!h.checkinDate.trim()) {
      warnings.push({ code: "missing_checkin", stepId: step.id, hotelId: h.id });
    }
    if (!h.checkoutDate.trim()) {
      warnings.push({ code: "missing_checkout", stepId: step.id, hotelId: h.id });
    }
    const ci = instantFromParts(hotelCheckinParts(h));
    const co = instantFromParts(hotelCheckoutParts(h));
    if (ci && co && co.getTime() <= ci.getTime()) {
      warnings.push({ code: "checkout_before_checkin", stepId: step.id, hotelId: h.id });
    }
  }

  if (!step.hotels.length) return warnings;

  const firstCi = earliestHotelCheckin(step.hotels);
  const lastCo = latestHotelCheckout(step.hotels);
  const effStartD = parseDdMmYyyyCalendarDate(effStart.date);
  const effEndD = parseDdMmYyyyCalendarDate(effEnd.date);
  const firstCiD = firstCi ? parseDdMmYyyyCalendarDate(firstCi.date) : null;
  const lastCoD = lastCo ? parseDdMmYyyyCalendarDate(lastCo.date) : null;

  if (effStartD && firstCiD && firstCiD < effStartD) {
    warnings.push({ code: "hotels_exceed_range", stepId: step.id });
  }
  if (effEndD && lastCoD && lastCoD > effEndD) {
    warnings.push({ code: "hotels_exceed_range", stepId: step.id });
  }
  if (effStartD && effEndD && firstCiD && lastCoD) {
    if (firstCiD > effStartD || lastCoD < effEndD) {
      warnings.push({ code: "hotels_not_covering", stepId: step.id });
    }
  }

  return warnings;
}
