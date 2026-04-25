"use client";

import { memo, useMemo } from "react";
import { Polyline } from "react-leaflet";
import type { MappedStep } from "@/lib/map/mapUtils";

export const MapRoute = memo(function MapRoute({
  points,
}: {
  points: MappedStep[];
}) {
  const polylinePositions = useMemo(
    () => points.map((p) => [p.coordinates.lat, p.coordinates.lng] as [number, number]),
    [points]
  );

  if (polylinePositions.length < 2) return null;

  return (
    <Polyline
      positions={polylinePositions}
      pathOptions={{
        color: "#2563eb",
        weight: 4,
        opacity: 0.85,
      }}
    />
  );
});
