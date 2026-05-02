import type { PlaceSearchHit } from "@/lib/places/types";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";

type GooglePlacePrediction = {
  place?: string;
  placeId?: string;
  text?: { text?: string };
  structuredFormat?: {
    mainText?: { text?: string };
    secondaryText?: { text?: string };
  };
};

type GoogleAutocompleteBody = {
  suggestions?: Array<{ placePrediction?: GooglePlacePrediction }>;
};

type GooglePlaceDetail = {
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  displayName?: string | { text?: string };
};

function googleMapsApiKey(): string | null {
  const k = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  const t = k?.trim();
  return t || null;
}

/** Maps Photon `lang` query values to BCP-47 codes accepted by Places (New). */
export function languageCodeForGoogle(photonOrBcpLang: string): string {
  const lower = photonOrBcpLang.toLowerCase();
  if (lower === "default") return "en";
  if (/^[a-z]{2}(-[a-z]{2})?$/i.test(lower)) return lower.slice(0, 5);
  return "en";
}

async function fetchPlaceDetailsNew(placeResourceName: string, apiKey: string): Promise<GooglePlaceDetail | null> {
  const path = placeResourceName.startsWith("places/") ? placeResourceName : `places/${placeResourceName}`;
  const url = `https://places.googleapis.com/v1/${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "location,formattedAddress,displayName",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as GooglePlaceDetail;
  } catch {
    return null;
  }
}

function displayNameText(d: GooglePlaceDetail): string | undefined {
  const n = d.displayName;
  if (typeof n === "string") return n.trim() || undefined;
  const t = n?.text?.trim();
  return t || undefined;
}

/**
 * Google Places Autocomplete (New) + Place Details (New) for coordinates.
 * Returns [] when no server API key is configured or on upstream failure.
 */
export async function searchGooglePlacesForAutocomplete(
  input: string,
  languageCode: string
): Promise<PlaceSearchHit[]> {
  const apiKey = googleMapsApiKey();
  if (!apiKey) return [];

  const trimmed = input.trim().slice(0, 200);
  if (trimmed.length < 2) return [];

  try {
    const acRes = await fetch(AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.place,suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
      },
      body: JSON.stringify({
        input: trimmed,
        languageCode: languageCodeForGoogle(languageCode),
      }),
      cache: "no-store",
    });
    if (!acRes.ok) return [];

    const body = (await acRes.json()) as GoogleAutocompleteBody;
    const suggestions = body.suggestions ?? [];
    const predictions: GooglePlacePrediction[] = [];
    for (const s of suggestions) {
      const p = s.placePrediction;
      if (p?.place && p.placeId) predictions.push(p);
    }

    const capped = predictions.slice(0, 8);
    const details = await Promise.all(capped.map((p) => fetchPlaceDetailsNew(p.place!, apiKey)));

    const out: PlaceSearchHit[] = [];
    for (let i = 0; i < capped.length; i++) {
      const pred = capped[i]!;
      const det = details[i];
      const latRaw = det?.location?.latitude;
      const lngRaw = det?.location?.longitude;
      if (!Number.isFinite(latRaw) || !Number.isFinite(lngRaw)) continue;
      const lat = latRaw as number;
      const lng = lngRaw as number;

      const label =
        pred.text?.text?.trim() ||
        det?.formattedAddress?.trim() ||
        displayNameText(det ?? {}) ||
        "Place";
      const title =
        pred.structuredFormat?.mainText?.text?.trim() ||
        displayNameText(det ?? {}) ||
        undefined;
      const description =
        pred.structuredFormat?.secondaryText?.text?.trim() ||
        det?.formattedAddress?.trim() ||
        label;

      out.push({
        id: `google:${pred.placeId}`,
        label,
        lat,
        lng,
        provider: "google",
        ...(title ? { title } : {}),
        description,
      });
    }
    return out;
  } catch {
    return [];
  }
}
