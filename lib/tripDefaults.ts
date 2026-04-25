import { v4 as uuidv4 } from "uuid";
import type { Trip, TripStep } from "@/lib/types/trip";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createEmptyStep(order: number): TripStep {
  return {
    id: uuidv4(),
    order,
    title: "",
    location: "",
    status: "todo",
    startDate: "",
    endDate: "",
    endDateOpen: true,
    nights: 0,
    duration: "",
    transport: "",
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

export function defaultTrip(id: string): Trip {
  const t = nowIso();
  return {
    id,
    title: "",
    tripStart: "",
    managePassword: "",
    tripAttachments: [],
    smartTimeline: true,
    autoCurrentByDate: true,
    createdAt: t,
    updatedAt: t,
    steps: [],
  };
}
