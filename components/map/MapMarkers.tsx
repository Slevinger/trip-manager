"use client";

import { memo, useMemo } from "react";
import { CircleMarker, Popup } from "react-leaflet";
import type { MappedStep } from "@/lib/map/mapUtils";
import { formatStepDateRange, statusColor } from "@/lib/map/mapUtils";

export const MapMarkers = memo(function MapMarkers({
  steps,
  onMarkerSelect,
}: {
  steps: MappedStep[];
  onMarkerSelect?: (stepId: string) => void;
}) {
  const markerData = useMemo(
    () =>
      steps.map((item) => ({
        ...item,
        color: statusColor(
          item.step.status === "done"
            ? "done"
            : item.step.status === "active"
              ? "active"
              : "todo"
        ),
        radius: item.step.status === "active" ? 14 : 10,
      })),
    [steps]
  );

  return (
    <>
      {markerData.map((item) => {
        const hotelsCount = item.step.type === "stay" ? item.step.hotels.length : 0;
        const location = item.step.location.trim() || "\u2014";
        const title = item.step.title.trim() || "Untitled step";
        const googleMapsHref = `https://www.google.com/maps?q=${item.coordinates.lat},${item.coordinates.lng}`;
        return (
          <CircleMarker
            key={item.step.id}
            center={[item.coordinates.lat, item.coordinates.lng]}
            radius={item.radius}
            pathOptions={{
              color: item.color,
              fillColor: item.color,
              fillOpacity: item.step.status === "active" ? 0.9 : 0.75,
              weight: item.step.status === "active" ? 3 : 2,
            }}
            eventHandlers={{
              click: () => onMarkerSelect?.(item.step.id),
            }}
          >
            <Popup minWidth={220}>
              <div className="space-y-1.5 text-xs text-zinc-700">
                <div className="text-sm font-semibold text-zinc-900">
                  {item.displayOrder}. {title}
                </div>
                <div>{location}</div>
                <div>{formatStepDateRange(item.step)}</div>
                <div>Transport: {item.step.type === "transit" ? "Transit step" : "\u2014"}</div>
                <div>Hotels: {hotelsCount}</div>
                <a
                  href={googleMapsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-blue-700 underline underline-offset-2"
                >
                  Open in Google Maps
                </a>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
});
