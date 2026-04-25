import type { Hotel, TripStep } from "@/lib/types/trip";
import { diffNightsInclusive, maxYmd, minYmd, parseYmd } from "@/lib/timeline/dates";

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

function earliestHotelCheckin(hotels: Hotel[]): string {
  const dates = hotels.map((h) => h.checkin).filter(Boolean);
  if (!dates.length) return "";
  return dates.reduce((acc, cur) => (acc ? minYmd(acc, cur) : cur));
}

function latestHotelCheckout(hotels: Hotel[]): string {
  const dates = hotels.map((h) => h.checkout).filter(Boolean);
  if (!dates.length) return "";
  return dates.reduce((acc, cur) => (acc ? maxYmd(acc, cur) : cur));
}

export function effectiveStepStart(step: TripStep): string {
  if (step.startDate.trim()) return step.startDate.trim();
  return earliestHotelCheckin(step.hotels);
}

export function effectiveStepEnd(step: TripStep): string {
  if (step.endDateOpen) {
    const fromHotels = latestHotelCheckout(step.hotels);
    if (fromHotels) return fromHotels;
  }
  return step.endDate.trim();
}

/** Recompute nights from effective start/end (inclusive nights between dates). */
export function computeNightsForStep(step: TripStep): number {
  const start = effectiveStepStart(step);
  const end = effectiveStepEnd(step);
  const ds = parseYmd(start);
  const de = parseYmd(end);
  if (!ds || !de) return 0;
  return diffNightsInclusive(ds, de);
}

/** When endDateOpen and hotel checkout changes, endDate should follow latest checkout. */
export function applyOpenEndDateFromHotels(step: TripStep): TripStep {
  if (!step.endDateOpen) return step;
  const latest = latestHotelCheckout(step.hotels);
  if (!latest) return { ...step, endDate: "" };
  return { ...step, endDate: latest };
}

/** Persisted step fields aligned with hotel timeline rules. */
export function syncStepWithHotels(step: TripStep): TripStep {
  const withEnd = applyOpenEndDateFromHotels(step);
  return {
    ...withEnd,
    nights: computeNightsForStep(withEnd),
  };
}

export function collectHotelDateWarnings(step: TripStep): HotelDateWarning[] {
  const warnings: HotelDateWarning[] = [];
  const effStart = effectiveStepStart(step);
  const effEnd = effectiveStepEnd(step);
  const nights = computeNightsForStep(step);

  if (step.hotels.length === 0 && nights > 0) {
    warnings.push({ code: "no_hotels_but_nights", stepId: step.id });
  }

  for (const h of step.hotels) {
    if (!h.checkin.trim()) {
      warnings.push({ code: "missing_checkin", stepId: step.id, hotelId: h.id });
    }
    if (!h.checkout.trim()) {
      warnings.push({ code: "missing_checkout", stepId: step.id, hotelId: h.id });
    }
    const ci = parseYmd(h.checkin);
    const co = parseYmd(h.checkout);
    if (ci && co && co <= ci) {
      warnings.push({ code: "checkout_before_checkin", stepId: step.id, hotelId: h.id });
    }
  }

  if (!step.hotels.length) return warnings;

  const firstCi = earliestHotelCheckin(step.hotels);
  const lastCo = latestHotelCheckout(step.hotels);
  if (effStart && firstCi && parseYmd(firstCi)! < parseYmd(effStart)!) {
    warnings.push({ code: "hotels_exceed_range", stepId: step.id });
  }
  if (effEnd && lastCo && parseYmd(lastCo)! > parseYmd(effEnd)!) {
    warnings.push({ code: "hotels_exceed_range", stepId: step.id });
  }
  if (effStart && effEnd && firstCi && lastCo) {
    const ps = parseYmd(effStart)!;
    const pe = parseYmd(effEnd)!;
    const hs = parseYmd(firstCi)!;
    const he = parseYmd(lastCo)!;
    if (hs > ps || he < pe) {
      warnings.push({ code: "hotels_not_covering", stepId: step.id });
    }
  }

  return warnings;
}
