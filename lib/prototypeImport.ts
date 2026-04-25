import { v4 as uuidv4 } from "uuid";
import type { Hotel, StepStatus, Trip, TripStep } from "@/lib/types/trip";

/** Strip time from `datetime-local` / ISO strings so date inputs work. */
export function datetimeLocalToYmd(value: string): string {
  const v = value.trim();
  if (!v) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : v.slice(0, 10);
}

function normStatus(v: unknown): StepStatus {
  if (v === "todo" || v === "active" || v === "done") return v;
  return "todo";
}

function normHotel(h: unknown): Hotel {
  const r = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
  return {
    id: typeof r.id === "string" && r.id ? r.id : uuidv4(),
    name: String(r.name ?? ""),
    checkin: datetimeLocalToYmd(String(r.checkin ?? "")),
    checkout: datetimeLocalToYmd(String(r.checkout ?? "")),
    bookingUrl: String(r.bookingUrl ?? ""),
    cost: Number(r.cost ?? 0) || 0,
    notes: String(r.notes ?? ""),
  };
}

function draftStepToTripStep(raw: unknown, order: number): TripStep {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hotels = Array.isArray(r.hotels)
    ? (r.hotels as unknown[]).map(normHotel)
    : [];
  const step: TripStep = {
    id: typeof r.id === "string" && r.id ? r.id : uuidv4(),
    order,
    title: String(r.title ?? ""),
    location: String(r.location ?? ""),
    status: normStatus(r.status),
    startDate: datetimeLocalToYmd(String(r.startDate ?? "")),
    endDate: datetimeLocalToYmd(String(r.endDate ?? "")),
    endDateOpen: Boolean(r.endDateOpen ?? false),
    nights: Number(r.nights ?? 0) || 0,
    duration: String(r.duration ?? ""),
    transport: String(r.transport ?? ""),
    arrivalSummary: String(r.arrivalSummary ?? ""),
    arrivalOptions: Array.isArray(r.arrivalOptions)
      ? (r.arrivalOptions as TripStep["arrivalOptions"])
      : [],
    hotels,
    transportCost: Number(r.transportCost ?? 0) || 0,
    foodCost: Number(r.foodCost ?? 0) || 0,
    activitiesCost: Number(r.activitiesCost ?? 0) || 0,
    otherCost: Number(r.otherCost ?? 0) || 0,
    notes: String(r.notes ?? ""),
    attachments: Array.isArray(r.attachments)
      ? (r.attachments as TripStep["attachments"])
      : [],
  };
  const lat = typeof r.lat === "number" ? r.lat : undefined;
  const lng = typeof r.lng === "number" ? r.lng : undefined;
  const coordObj =
    r.coordinates && typeof r.coordinates === "object"
      ? (r.coordinates as { lat?: unknown; lng?: unknown })
      : null;
  const coordLat = typeof coordObj?.lat === "number" ? coordObj.lat : lat;
  const coordLng = typeof coordObj?.lng === "number" ? coordObj.lng : lng;
  if (
    typeof coordLat === "number" &&
    Number.isFinite(coordLat) &&
    typeof coordLng === "number" &&
    Number.isFinite(coordLng) &&
    coordLat >= -90 &&
    coordLat <= 90 &&
    coordLng >= -180 &&
    coordLng <= 180
  ) {
    step.coordinates = { lat: coordLat, lng: coordLng };
  }
  const mx = typeof r.mapX === "number" ? r.mapX : undefined;
  const my = typeof r.mapY === "number" ? r.mapY : undefined;
  if (typeof mx === "number" && Number.isFinite(mx)) step.mapX = mx;
  if (typeof my === "number" && Number.isFinite(my)) step.mapY = my;
  return step;
}

/**
 * Imports the JSON shape used by the original single-file HTML prototype
 * (`tripTitle`, `tripStart`, `smartTimeline`, `autoCurrentByDate`, `steps`).
 */
export function prototypeDraftToTrip(current: Trip, raw: unknown): Trip {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid JSON");
  }
  const o = raw as Record<string, unknown>;
  const stepsRaw = o.steps;
  if (!Array.isArray(stepsRaw)) {
    throw new Error("Expected a \"steps\" array on the root object");
  }
  return {
    ...current,
    title: String(o.tripTitle ?? o.title ?? current.title),
    tripStart: datetimeLocalToYmd(
      String(o.tripStart ?? current.tripStart ?? "")
    ),
    managePassword: String(o.managePassword ?? current.managePassword ?? ""),
    tripAttachments: Array.isArray(o.tripAttachments)
      ? (o.tripAttachments as Trip["tripAttachments"])
      : current.tripAttachments ?? [],
    smartTimeline: o.smartTimeline !== false,
    autoCurrentByDate: o.autoCurrentByDate !== false,
    steps: stepsRaw.map((s, i) => draftStepToTripStep(s, i)),
  };
}
