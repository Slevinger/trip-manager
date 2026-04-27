import { v4 as uuidv4 } from "uuid";
import type { Hotel, StepStatus, TripStep } from "@/lib/types/trip";
import { migrateLegacyCombined } from "@/lib/timeline/dates";

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

function hotelFromLegacyCheckinCheckout(checkinRaw: string, checkoutRaw: string): Hotel {
  const ci = migrateLegacyCombined(checkinRaw);
  const co = migrateLegacyCombined(checkoutRaw);
  return {
    id: uuidv4(),
    name: "",
    checkinDate: ci.date,
    checkinTime: ci.time,
    checkoutDate: co.date,
    checkoutTime: co.time,
    bookingUrl: "",
    cost: 0,
    notes: "",
  };
}

function hotelsFromDiagram(o: Record<string, unknown>): Hotel[] {
  if (o.hasHotel !== true && o.hasHotel !== "true") return [];
  const name = String(o.hotelName ?? "").trim();
  if (!name) return [];
  const h = hotelFromLegacyCheckinCheckout(
    String(o.checkin ?? ""),
    String(o.checkout ?? "")
  );
  return [{ ...h, name }];
}

/**
 * Maps an array of diagram-export objects into {@link TripStep} rows
 * (title, location, nights, notes, optional x/y -> mapX/mapY, optional hotel/transports).
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
    const start = migrateLegacyCombined(String(o.startDate ?? o.checkin ?? ""));
    const end = migrateLegacyCombined(String(o.endDate ?? o.checkout ?? ""));
    const hotels = (() => {
      if (Array.isArray(o.hotels) && o.hotels.length > 0) {
        return (o.hotels as unknown[]).map((h) => {
          const r = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
          const ci = migrateLegacyCombined(String(r.checkin ?? ""));
          const co = migrateLegacyCombined(String(r.checkout ?? ""));
          return {
            id: typeof r.id === "string" && r.id ? String(r.id) : uuidv4(),
            name: String(r.name ?? ""),
            checkinDate: ci.date,
            checkinTime: ci.time,
            checkoutDate: co.date,
            checkoutTime: co.time,
            bookingUrl: String(r.bookingUrl ?? ""),
            cost: Number(r.cost ?? 0) || 0,
            notes: String(r.notes ?? ""),
          } satisfies Hotel;
        });
      }
      return hotelsFromDiagram(o);
    })();
    const legacyTransport = String(o.transport ?? "").trim();
    const base = {
      id,
      order: index,
      title: String(o.title ?? ""),
      location: String(o.location ?? ""),
      status: normStatus(o.status),
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time,
      endDateOpen: true,
      nights: Number(o.nights ?? 0) || 0,
      duration: String(o.duration ?? ""),
      arrivalSummary: String(o.arrivalSummary ?? ""),
      arrivalOptions: [],
      transportCost: Number(o.transportCost ?? 0) || 0,
      foodCost: Number(o.foodCost ?? 0) || 0,
      activitiesCost: Number(o.activitiesCost ?? 0) || 0,
      otherCost: Number(o.otherCost ?? 0) || 0,
      notes: String(o.notes ?? ""),
      attachments: [],
    };
    const step: TripStep =
      hotels.length > 0
        ? {
            ...base,
            type: "stay",
            hotels,
          }
        : {
            ...base,
            type: "transit",
            transports: legacyTransport
              ? [
                  {
                    id: uuidv4(),
                    title: legacyTransport,
                    from: "",
                    to: "",
                    details: "",
                    duration: String(o.duration ?? ""),
                    cost: "",
                  },
                ]
              : [],
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
