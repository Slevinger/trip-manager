import { v4 as uuidv4 } from "uuid";
import type { Hotel, StepStatus, TripStep } from "@/lib/types/trip";

function optNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function normStatus(v: unknown): StepStatus {
  if (v === "todo" || v === "active" || v === "done") return v;
  return "todo";
}

function hotelsFromDiagram(o: Record<string, unknown>): Hotel[] {
  if (o.hasHotel !== true && o.hasHotel !== "true") return [];
  const name = String(o.hotelName ?? "").trim();
  if (!name) return [];
  return [
    {
      id: uuidv4(),
      name,
      checkin: String(o.checkin ?? ""),
      checkout: String(o.checkout ?? ""),
      bookingUrl: String(o.bookingUrl ?? ""),
      cost: 0,
      notes: "",
    },
  ];
}

/**
 * Maps an array of diagram-export objects into {@link TripStep} rows
 * (title, location, nights, transport, notes, optional x/y → mapX/mapY, optional hotel).
 */
export function diagramJsonToTripSteps(raw: unknown): TripStep[] {
  if (!Array.isArray(raw)) {
    throw new Error("Expected a JSON array");
  }
  return raw.map((item, index) => {
    const o = (item && typeof item === "object" ? item : {}) as Record<
      string,
      unknown
    >;
    const id =
      typeof o.id === "string" && /^[0-9a-f-]{36}$/i.test(o.id)
        ? o.id
        : uuidv4();
    const mx = optNum(o.mapX ?? o.x);
    const my = optNum(o.mapY ?? o.y);
    const step: TripStep = {
      id,
      order: index,
      title: String(o.title ?? ""),
      location: String(o.location ?? ""),
      status: normStatus(o.status),
      startDate: String(o.startDate ?? o.checkin ?? ""),
      endDate: String(o.endDate ?? o.checkout ?? ""),
      endDateOpen: true,
      nights: Number(o.nights ?? 0) || 0,
      duration: String(o.duration ?? ""),
      transport: String(o.transport ?? ""),
      arrivalSummary: String(o.arrivalSummary ?? ""),
      arrivalOptions: [],
      hotels: (() => {
        if (Array.isArray(o.hotels) && o.hotels.length > 0) {
          return (o.hotels as unknown[]).map((h) => {
            const r = (h && typeof h === "object" ? h : {}) as Record<
              string,
              unknown
            >;
            return {
              id:
                typeof r.id === "string" && r.id
                  ? String(r.id)
                  : uuidv4(),
              name: String(r.name ?? ""),
              checkin: String(r.checkin ?? ""),
              checkout: String(r.checkout ?? ""),
              bookingUrl: String(r.bookingUrl ?? ""),
              cost: Number(r.cost ?? 0) || 0,
              notes: String(r.notes ?? ""),
            } satisfies Hotel;
          });
        }
        return hotelsFromDiagram(o);
      })(),
      transportCost: Number(o.transportCost ?? 0) || 0,
      foodCost: Number(o.foodCost ?? 0) || 0,
      activitiesCost: Number(o.activitiesCost ?? 0) || 0,
      otherCost: Number(o.otherCost ?? 0) || 0,
      notes: String(o.notes ?? ""),
    };
    const lat = optNum(o.lat);
    const lng = optNum(o.lng);
    const coordsRaw =
      o.coordinates && typeof o.coordinates === "object"
        ? (o.coordinates as { lat?: unknown; lng?: unknown })
        : null;
    const coordLat = optNum(coordsRaw?.lat ?? lat);
    const coordLng = optNum(coordsRaw?.lng ?? lng);
    if (
      coordLat !== undefined &&
      coordLng !== undefined &&
      coordLat >= -90 &&
      coordLat <= 90 &&
      coordLng >= -180 &&
      coordLng <= 180
    ) {
      step.coordinates = { lat: coordLat, lng: coordLng };
    }
    if (mx !== undefined) step.mapX = mx;
    if (my !== undefined) step.mapY = my;
    return step;
  });
}

export function parseDiagramStepsFromJson(text: string): TripStep[] {
  const raw = JSON.parse(text) as unknown;
  return diagramJsonToTripSteps(raw);
}
