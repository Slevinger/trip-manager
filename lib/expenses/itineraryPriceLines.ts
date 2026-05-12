import type { Money, TransitStep, Trip, TripStep } from "@/lib/types/trip";
import { sortTripStepsByStartTime } from "@/lib/tripStepSort";

/** One priced row from the itinerary (interval `price` or transit `totalManualPrice`). */
export interface ItineraryPriceLine {
  id: string;
  stepId: string;
  stepTitle: string;
  stepType: TripStep["stepType"];
  intervalId: string | null;
  /** Raw interval title; UI may substitute {@link common.untitled}. */
  intervalTitle: string;
  /** yyyy-mm-dd from interval (or transit anchor) start for sorting. */
  dateKey: string;
  money: Money;
  source: "interval_price" | "transit_manual";
}

function pushIfPositive(
  out: ItineraryPriceLine[],
  row: Omit<ItineraryPriceLine, "money"> & { money: Money | null | undefined }
): void {
  const m = row.money;
  if (!m || !Number.isFinite(m.amount) || m.amount <= 0) return;
  out.push({ ...row, money: m });
}

/**
 * Flat list of itinerary monetary rows that feed budget charts (aligned with
 * {@link spendByDayFromItinerary} interval-level adds, including transit manual).
 */
export function collectItineraryPriceLines(trip: Trip): ItineraryPriceLine[] {
  const out: ItineraryPriceLine[] = [];
  const steps = sortTripStepsByStartTime(trip.steps ?? []);

  for (const step of steps) {
    const stepTitle = step.title.trim() || "—";

    if (step.stepType === "stay") {
      for (const int of step.stepIntervals) {
        pushIfPositive(out, {
          id: `${step.id}:${int.id}:price`,
          stepId: step.id,
          stepTitle,
          stepType: "stay",
          intervalId: int.id,
          intervalTitle: int.title.trim(),
          dateKey: int.startTime.slice(0, 10),
          money: int.price,
          source: "interval_price",
        });
      }
    } else if (step.stepType === "transit") {
      const ts = step as TransitStep;
      for (const int of ts.stepIntervals) {
        pushIfPositive(out, {
          id: `${step.id}:${int.id}:price`,
          stepId: step.id,
          stepTitle,
          stepType: "transit",
          intervalId: int.id,
          intervalTitle: int.title.trim(),
          dateKey: int.startTime.slice(0, 10),
          money: int.price,
          source: "interval_price",
        });
      }
      const anchor = ts.stepIntervals[0]?.startTime ?? step.startTime;
      pushIfPositive(out, {
        id: `${step.id}:transit-manual`,
        stepId: step.id,
        stepTitle,
        stepType: "transit",
        intervalId: null,
        intervalTitle: "",
        dateKey: anchor.slice(0, 10),
        money: ts.totalManualPrice,
        source: "transit_manual",
      });
    } else if (step.stepType === "activity") {
      for (const int of step.stepIntervals) {
        pushIfPositive(out, {
          id: `${step.id}:${int.id}:price`,
          stepId: step.id,
          stepTitle,
          stepType: "activity",
          intervalId: int.id,
          intervalTitle: int.title.trim(),
          dateKey: int.startTime.slice(0, 10),
          money: int.price,
          source: "interval_price",
        });
      }
    }
  }

  out.sort((a, b) => {
    const c = a.dateKey.localeCompare(b.dateKey);
    if (c !== 0) return c;
    return a.id.localeCompare(b.id);
  });
  return out;
}
