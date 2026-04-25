"use client";

import { memo, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import type { TripStep } from "@/lib/types/trip";
import { computeMapData } from "@/lib/map/mapUtils";
import { MapMarkers } from "@/components/map/MapMarkers";
import { MapRoute } from "@/components/map/MapRoute";
import { MapLegend } from "@/components/map/MapLegend";

const THAILAND_CENTER: [number, number] = [13.0, 100.0];

function MapAutoFit({ points }: { points: Array<{ lat: number; lng: number }> }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) {
      map.setView(THAILAND_CENTER, 5);
      return;
    }
    if (points.length === 1) {
      map.flyTo([points[0].lat, points[0].lng], 9, { duration: 0.7 });
      return;
    }
    map.fitBounds(
      points.map((p) => [p.lat, p.lng] as [number, number]),
      { padding: [32, 32], animate: true, duration: 0.8 }
    );
  }, [map, points]);

  return null;
}

function MapFocusStep({
  focusedCoordinates,
}: {
  focusedCoordinates: { lat: number; lng: number } | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!focusedCoordinates) return;
    map.flyTo([focusedCoordinates.lat, focusedCoordinates.lng], Math.max(map.getZoom(), 9), {
      duration: 0.7,
    });
  }, [focusedCoordinates, map]);

  return null;
}

export const MapView = memo(function MapView({
  steps,
  focusedStepId,
  onMarkerSelect,
}: {
  steps: TripStep[];
  focusedStepId?: string | null;
  onMarkerSelect?: (stepId: string) => void;
}) {
  const mapData = useMemo(() => computeMapData(steps), [steps]);
  const points = useMemo(
    () => mapData.mappedSteps.map((step) => step.coordinates),
    [mapData.mappedSteps]
  );
  const focusedCoordinates = useMemo(
    () =>
      mapData.mappedSteps.find((mapped) => mapped.step.id === focusedStepId)?.coordinates ?? null,
    [focusedStepId, mapData.mappedSteps]
  );

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Route map</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Mapped: {mapData.mappedSteps.length} · Unmapped: {mapData.unmappedSteps.length}
      </p>
      <div className="relative mt-3 overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <MapLegend />
        <MapContainer
          center={THAILAND_CENTER}
          zoom={6}
          scrollWheelZoom
          className="h-[360px] w-full touch-pan-x touch-pan-y md:h-[500px]"
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />
          <MapMarkers steps={mapData.mappedSteps} onMarkerSelect={onMarkerSelect} />
          <MapRoute points={mapData.mappedSteps} />
          <MapAutoFit points={points} />
          <MapFocusStep focusedCoordinates={focusedCoordinates} />
        </MapContainer>
      </div>
      {mapData.unmappedSteps.length > 0 ? (
        <div className="mt-3 space-y-1 text-xs text-amber-800 dark:text-amber-200">
          {mapData.unmappedSteps.map((step) => (
            <p key={step.id}>Could not map: {step.title.trim() || step.location.trim() || step.id}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
});
