import type { StepStatus, TripStep } from "@/lib/types/trip";
import {
  effectiveStepEndParts,
  effectiveStepStartParts,
} from "@/lib/timeline/hotelsAndDates";
import { resolveLocationCoordinates } from "@/lib/map/locationResolver";

export interface MappedStep {
  step: TripStep;
  index: number;
  displayOrder: number;
  coordinates: { lat: number; lng: number };
}

export interface MapComputation {
  orderedSteps: TripStep[];
  mappedSteps: MappedStep[];
  unmappedSteps: TripStep[];
}

function isFiniteCoord(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasValidCoordinates(step: TripStep): step is TripStep & {
  coordinates: { lat: number; lng: number };
} {
  const lat = step.coordinates?.lat;
  const lng = step.coordinates?.lng;
  return (
    isFiniteCoord(lat) &&
    isFiniteCoord(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function getOrderedSteps(steps: TripStep[]): TripStep[] {
  return [...steps].sort((a, b) => {
    const ao = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
    const bo = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });
}

export function resolveStepCoordinates(step: TripStep): { lat: number; lng: number } | null {
  if (hasValidCoordinates(step)) return step.coordinates;
  if (!step.location.trim()) return null;
  return resolveLocationCoordinates(step.location);
}

export function computeMapData(steps: TripStep[]): MapComputation {
  const orderedSteps = getOrderedSteps(steps);
  const mappedSteps: MappedStep[] = [];
  const unmappedSteps: TripStep[] = [];

  orderedSteps.forEach((step, index) => {
    const coordinates = resolveStepCoordinates(step);
    if (!coordinates) {
      unmappedSteps.push(step);
      return;
    }
    mappedSteps.push({ step, index, displayOrder: index + 1, coordinates });
  });

  return { orderedSteps, mappedSteps, unmappedSteps };
}

export function statusColor(status: StepStatus): string {
  if (status === "active") return "#2563eb";
  if (status === "done") return "#16a34a";
  return "#6b7280";
}

function joinDateTime(date: string, time: string): string {
  const d = date.trim();
  const t = time.trim();
  if (!d) return "";
  return t ? `${d} ${t}` : d;
}

export function formatStepDateRange(step: TripStep): string {
  const a = effectiveStepStartParts(step);
  const b = effectiveStepEndParts(step);
  const left = joinDateTime(a.date, a.time) || "\u2014";
  const right = joinDateTime(b.date, b.time) || "\u2014";
  return `${left} \u2192 ${right}`;
}
