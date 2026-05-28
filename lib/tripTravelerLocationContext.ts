import type { Trip, TripLiveLocation } from "@/lib/types/trip";

/** Max age for a client-reported GPS ping to be trusted on the server (ms). */
export const VIEWER_DEVICE_PING_MAX_AGE_MS = 15 * 60 * 1000;

export type ViewerDevicePing = {
  lat: number;
  lon: number;
  /** `Date.now()` when the browser captured the fix. */
  capturedAtMs: number;
  accuracyM?: number;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

function finiteNum(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parses optional `viewerDevicePing` from trip-assistant / evolve POST bodies.
 * Rejects stale, non-finite, or out-of-range coordinates.
 */
export function parseViewerDevicePing(raw: unknown, nowMs: number): ViewerDevicePing | null {
  if (!isRecord(raw)) return null;
  const lat = finiteNum(raw.lat);
  const lon = finiteNum(raw.lon);
  const capturedAtMs = finiteNum(raw.capturedAtMs);
  if (lat == null || lon == null || capturedAtMs == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const age = nowMs - capturedAtMs;
  if (!Number.isFinite(age) || age < 0 || age > VIEWER_DEVICE_PING_MAX_AGE_MS) return null;
  const acc = finiteNum(raw.accuracyM);
  const ping: ViewerDevicePing = { lat, lon, capturedAtMs };
  if (acc != null && acc > 0 && acc < 50_000) ping.accuracyM = acc;
  return ping;
}

function participantLabel(trip: Trip, participantKey: string): string {
  const k = participantKey.trim().toLowerCase();
  const tr = trip.travelers.find((x) => x.email?.trim().toLowerCase() === k);
  if (tr?.name?.trim()) return tr.name.trim();
  const vw = trip.viewers?.find((x) => x.email?.trim().toLowerCase() === k);
  if (vw?.name?.trim()) return vw.name.trim();
  return participantKey.includes("@") ? participantKey.split("@")[0]! : participantKey;
}

function isoAgeLine(nowMs: number, iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown age";
  const min = Math.max(0, Math.round((nowMs - t) / 60_000));
  if (min < 1) return "updated within the last minute";
  if (min < 60) return `updated ~${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `updated ~${h} h ago`;
  const d = Math.floor(h / 24);
  return `updated ~${d} d ago`;
}

/**
 * Human-readable block for the LLM: optional **fresh** device ping for the sender.
 * Synced shares already appear under `liveLocations` in the trip JSON sent to the assistant.
 */
export function buildTravelerLocationContextAppendix(
  trip: Trip,
  opts: {
    nowMs: number;
    viewerDevicePing?: ViewerDevicePing | null;
    viewerEmailLower?: string | null;
    /** When true, also list synced `liveLocations` (for evolve, which has no trip JSON). */
    includeSyncedLiveLocations?: boolean;
  }
): string {
  const lines: string[] = [];

  if (opts.includeSyncedLiveLocations) {
    const live = trip.liveLocations;
    if (live && typeof live === "object") {
      const entries = Object.entries(live).filter(([, v]) => v && typeof v === "object");
      if (entries.length > 0) {
        lines.push("### Traveler last-known coordinates (from trip document)");
        lines.push(
          "Voluntary GPS shares keyed by participant id (often lowercased email). WGS84; not continuous tracking."
        );
        for (const [key, loc] of entries) {
          const l = loc as TripLiveLocation;
          const name = (l.name?.trim() || participantLabel(trip, key)).trim() || key;
          const age = isoAgeLine(opts.nowMs, l.updatedAt);
          lines.push(
            `- **${name}** (${key}): lat ${l.lat}, lon ${l.lon}, ${age} (recorded ${l.updatedAt})`
          );
        }
      }
    }
  }

  const ping = opts.viewerDevicePing;
  const em = opts.viewerEmailLower?.trim().toLowerCase();
  if (ping) {
    const sec = Math.max(0, Math.round((opts.nowMs - ping.capturedAtMs) / 1000));
    const acc =
      typeof ping.accuracyM === "number" && Number.isFinite(ping.accuracyM)
        ? `, accuracy ~${Math.round(ping.accuracyM)} m`
        : "";
    const who = em ? `Participant id **${em}**` : "The client that sent this request";
    lines.push("### Fresh device ping (this request only)");
    lines.push(
      `${who} reported lat ${ping.lat}, lon ${ping.lon} about ${sec}s before this request${acc}. ` +
        "May be newer than `trip.liveLocations` in the JSON above."
    );
  }

  return lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
}
