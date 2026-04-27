import { v4 as uuidv4 } from "uuid";
import { applyTransitEndFromArrivals } from "@/lib/timeline/hotelsAndDates";
import type { StayStep, TransitStep, Trip, TripStep } from "@/lib/types/trip";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createEmptyStep(order: number): TripStep {
  return {
    id: uuidv4(),
    order,
    type: "stay",
    title: "",
    location: "",
    status: "todo",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    endDateOpen: true,
    nights: 0,
    duration: "",
    arrivalSummary: "",
    arrivalOptions: [],
    hotels: [],
    transportCost: 0,
    foodCost: 0,
    activitiesCost: 0,
    otherCost: 0,
    notes: "",
    attachments: [],
  };
}

/**
 * New step placed after `afterStep`. After a transit leg, default to stay (next place).
 */
export function createEmptyStepInsertedAfter(afterStep: TripStep, order: number): TripStep {
  if (afterStep.type === "transit") {
    return { ...createEmptyStep(order), type: "stay", hotels: [] };
  }
  return createEmptyStep(order);
}

/** Convert any step shape to a stay (wizard / type switch). */
export function morphStepToStay(step: TripStep): StayStep {
  if (step.type === "stay") return step;
  const {
    transports: _tr,
    transitEndManual: _tm,
    fromStayStepId: _f,
    toStayStepId: _to,
    ...base
  } = step;
  return {
    ...base,
    type: "stay",
    hotels: [],
    endDateOpen: true,
  };
}

/** Convert any step shape to a transit (wizard / type switch). */
export function morphStepToTransit(step: TripStep): TransitStep {
  if (step.type === "transit") {
    return applyTransitEndFromArrivals({ ...step, endDateOpen: false });
  }
  const { hotels: _h, ...rest } = step;
  return applyTransitEndFromArrivals({
    ...rest,
    type: "transit",
    transports: [],
    endDateOpen: false,
    transitEndManual: false,
    arrivalSummary: step.arrivalSummary ?? "",
    arrivalOptions: [],
    fromStayStepId: undefined,
    toStayStepId: undefined,
  });
}

export function defaultTrip(id: string): Trip {
  const t = nowIso();
  return {
    id,
    title: "",
    tripStartDate: "",
    tripStartTime: "",
    budget: 0,
    managePassword: "",
    ownerUid: "",
    ownerEmail: "",
    ownerEmailLower: "",
    accessMode: "invited_only",
    tripAttachments: [],
    smartTimeline: true,
    autoCurrentByDate: true,
    createdAt: t,
    updatedAt: t,
    steps: [],
  };
}
