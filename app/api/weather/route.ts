import { NextResponse } from "next/server";
import { fetchOpenMeteoDaily } from "@/lib/weather/openMeteo";

const MAX_RANGE_DAYS = 16;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const latRaw = url.searchParams.get("lat");
  const lonRaw = url.searchParams.get("lon");
  const lat = Number.parseFloat(latRaw ?? "");
  const lon = Number.parseFloat(lonRaw ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat/lon required" }, { status: 400 });
  }
  const startIso = url.searchParams.get("start") ?? undefined;
  const endIso = url.searchParams.get("end") ?? undefined;
  // Open-Meteo only returns a 16-day window from today; clamp accordingly so
  // multi-week trips still produce a useful preview rather than an empty array.
  const todayMs = Date.now();
  let normalizedStart = startIso;
  let normalizedEnd = endIso;
  if (startIso) {
    const startMs = Date.parse(startIso);
    if (Number.isFinite(startMs) && startMs < todayMs) {
      normalizedStart = new Date(todayMs).toISOString();
    }
  }
  if (endIso && normalizedStart) {
    const endMs = Date.parse(endIso);
    const startMs = Date.parse(normalizedStart);
    if (Number.isFinite(endMs) && Number.isFinite(startMs)) {
      const cap = startMs + MAX_RANGE_DAYS * 24 * 3600 * 1000;
      if (endMs > cap) normalizedEnd = new Date(cap).toISOString();
    }
  }

  try {
    const daily = await fetchOpenMeteoDaily({
      lat,
      lon,
      startDateIso: normalizedStart,
      endDateIso: normalizedEnd,
    });
    return NextResponse.json(
      { daily },
      {
        headers: {
          "Cache-Control": "public, max-age=900, s-maxage=1800, stale-while-revalidate=3600",
        },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "weather error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
