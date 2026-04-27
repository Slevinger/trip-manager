import { NextResponse } from "next/server";
import {
  isPhotonLangCode,
  type PhotonLangCode,
} from "@/lib/places/photonLang";
import type { PlaceSearchHit } from "@/lib/places/types";

/**
 * Proxies place search to Photon (OpenStreetMap data, Komoot-hosted).
 * Keeps requests server-side (stable User-Agent, no browser CORS to third parties).
 *
 * Alternatives you can swap in here: Mapbox Geocoding, HERE, TomTom,
 * self-hosted Nominatim, or Google Places — same response shape if you adapt mapping.
 */
const PHOTON = "https://photon.komoot.io/api/";

type PhotonFeature = {
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    country?: string;
    postcode?: string;
    type?: string;
  };
};

function labelFromProperties(p: NonNullable<PhotonFeature["properties"]>): string {
  const street = [p.street, p.housenumber].filter(Boolean).join(" ").trim();
  const chunks: string[] = [];
  if (street) chunks.push(street);
  for (const x of [p.name, p.city, p.state, p.country, p.postcode]) {
    const s = x?.trim();
    if (s && !chunks.some((c) => c === s || c.includes(s) || s.includes(c))) chunks.push(s);
  }
  return chunks.join(", ") || p.name?.trim() || "";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("q")?.trim() ?? "";
  if (raw.length < 2) {
    return NextResponse.json({ results: [] satisfies PlaceSearchHit[] });
  }
  if (raw.length > 200) {
    return NextResponse.json({ results: [] satisfies PlaceSearchHit[] });
  }

  const langRaw = searchParams.get("lang")?.toLowerCase() ?? "en";
  const lang: PhotonLangCode = isPhotonLangCode(langRaw) ? langRaw : "en";

  const url = new URL(PHOTON);
  url.searchParams.set("q", raw);
  url.searchParams.set("limit", "10");
  url.searchParams.set("lang", lang);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "TripPlanner/1.0 (place-search)",
        "Accept-Language": lang === "default" ? "*" : lang,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { results: [], error: "upstream" },
        { status: 502 }
      );
    }
    const data = (await res.json()) as { features?: PhotonFeature[] };
    const features = data.features ?? [];
    const results: PlaceSearchHit[] = [];

    for (const f of features) {
      const coords = f.geometry?.coordinates;
      const p = f.properties;
      if (!coords || coords.length < 2 || !p) continue;
      const [lng, lat] = coords;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const label = labelFromProperties(p).trim();
      if (!label) continue;
      const id =
        p.osm_type && p.osm_id != null
          ? `${p.osm_type}:${p.osm_id}`
          : `${lat},${lng},${label}`;
      results.push({ id, label, lat, lng });
    }

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json(
      { results: [], error: "fetch" },
      { status: 502 }
    );
  }
}
