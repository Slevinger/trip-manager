import type { Trip, TripHeroCoverPersistPayload } from "@/lib/types/trip";

/** Minimal trip snapshot sent to `/api/trip/hero-cover`. */
export type TripHeroCoverRequestTrip = Pick<Trip, "id" | "title" | "description"> & {
  destinations: Array<Pick<Trip["destinations"][number], "id" | "title" | "description" | "location">>;
};

export function tripPayloadForHeroCover(trip: Trip): TripHeroCoverRequestTrip {
  return {
    id: trip.id,
    title: trip.title,
    description: trip.description,
    destinations: trip.destinations.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      location: d.location,
    })),
  };
}

export async function fetchTripHeroCoverFromApi(
  trip: Trip,
  signal?: AbortSignal
): Promise<TripHeroCoverPersistPayload> {
  const res = await fetch("/api/trip/hero-cover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trip: tripPayloadForHeroCover(trip) }),
    signal,
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body !== null && "error" in body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Hero cover failed (${res.status})`;
    throw new Error(msg);
  }
  const heroCover =
    typeof body === "object" && body !== null && "heroCover" in body
      ? (body as { heroCover?: TripHeroCoverPersistPayload }).heroCover
      : undefined;
  if (!heroCover?.url?.trim()) {
    throw new Error("Invalid hero cover response");
  }
  return heroCover;
}
