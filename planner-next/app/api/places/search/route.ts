import { NextResponse } from "next/server";
import { searchGooglePlacesForAutocomplete } from "@/lib/places/googlePlacesServer";
import { isPhotonLangCode, type PhotonLangCode } from "@/lib/places/photonLang";
import type { PlaceSearchHit } from "@/lib/places/types";

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

async function fetchPhotonHits(
  raw: string,
  lang: PhotonLangCode
): Promise<{ hits: PlaceSearchHit[]; upstreamError: boolean }> {
  const url = new URL(PHOTON);
  url.searchParams.set("q", raw);
  url.searchParams.set("limit", "10");
  url.searchParams.set("lang", lang);

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "TripPlannerNext/1.0 (place-search)",
      "Accept-Language": lang === "default" ? "*" : lang,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    return { hits: [], upstreamError: true };
  }
  const data = (await res.json()) as { features?: PhotonFeature[] };
  const features = data.features ?? [];
  const hits: PlaceSearchHit[] = [];

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
    const title = p.name?.trim() || undefined;
    const descParts = [p.city, p.state, p.country].filter(Boolean).map((s) => String(s).trim());
    const description = (descParts.length ? descParts.join(", ") : label).trim();
    hits.push({
      id,
      label,
      lat,
      lng,
      provider: "photon",
      ...(title ? { title } : {}),
      description,
    });
  }
  return { hits, upstreamError: false };
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

  try {
    const [googleHits, photonPack] = await Promise.all([
      searchGooglePlacesForAutocomplete(raw, langRaw),
      fetchPhotonHits(raw, lang),
    ]);
    const results = [...googleHits, ...photonPack.hits];
    if (photonPack.upstreamError && googleHits.length === 0) {
      return NextResponse.json({ results: [], error: "upstream" }, { status: 502 });
    }
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [], error: "fetch" }, { status: 502 });
  }
}
