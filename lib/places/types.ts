/** Payload when the user picks a row in {@link PlaceSearchInput} (trip picks or map search). */
export type PlaceSearchPickPayload = {
  label: string;
  /** Omitted for some registry-only trip picks without stored coordinates. */
  lat?: number;
  lng?: number;
  /** Short POI / place name when distinct from {@link label}. */
  title?: string;
  /** Locality / region line for {@link Destination#description}. */
  description?: string;
  /** When set, the pick is an existing row in {@link Trip#destinations} (same id). */
  destinationId?: string;
};

export type PlaceSearchHit = PlaceSearchPickPayload & {
  id: string;
  lat: number;
  lng: number;
  /** Source of the row; used for section labels in the address dropdown. */
  provider?: "google" | "photon";
};
