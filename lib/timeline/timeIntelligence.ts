import type { Trip } from "@/lib/types/trip";
import {
  collectHotelDateWarnings,
  effectiveStepEndParts,
  effectiveStepStartParts,
} from "@/lib/timeline/hotelsAndDates";
import { instantFromParts } from "@/lib/timeline/dates";

export type TimeIntelCode =
  | "missing_dates"
  | "end_before_start"
  | "step_nights_no_hotels"
  | "hotels_cover"
  | "long_transfer"
  | "short_transition"
  | "gap_between_steps";

export interface TimeIntelWarning {
  code: TimeIntelCode;
  stepId?: string;
  meta?: Record<string, string | number | boolean | undefined>;
}

export function collectTimeIntelligenceWarnings(trip: Trip): TimeIntelWarning[] {
  const out: TimeIntelWarning[] = [];
  const steps = [...trip.steps].sort((a, b) => a.order - b.order);

  for (const s of steps) {
    const start = effectiveStepStartParts(s);
    const end = effectiveStepEndParts(s);
    if (!start.date.trim() || !end.date.trim()) {
      out.push({ code: "missing_dates", stepId: s.id });
    } else {
      const ds = instantFromParts(start);
      const de = instantFromParts(end);
      if (ds && de && de.getTime() < ds.getTime()) {
        out.push({ code: "end_before_start", stepId: s.id });
      }
    }

    const hotelWs = collectHotelDateWarnings(s);
    if (hotelWs.some((w) => w.code === "no_hotels_but_nights")) {
      out.push({ code: "step_nights_no_hotels", stepId: s.id });
    }
    if (hotelWs.some((w) => w.code === "hotels_not_covering")) {
      out.push({ code: "hotels_cover", stepId: s.id });
    }

  }

  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i];
    const b = steps[i + 1];
    const aEnd = effectiveStepEndParts(a);
    const bStart = effectiveStepStartParts(b);
    const da = aEnd.date ? instantFromParts(aEnd) : null;
    const db = bStart.date ? instantFromParts(bStart) : null;
    if (da && db) {
      const gapDays = Math.round((db.getTime() - da.getTime()) / 86400000);
      if (gapDays < 0) {
        out.push({
          code: "short_transition",
          stepId: b.id,
          meta: { days: gapDays },
        });
      } else if (gapDays > 1) {
        out.push({
          code: "gap_between_steps",
          stepId: b.id,
          meta: { days: gapDays },
        });
      }
    }
  }

  return out;
}
