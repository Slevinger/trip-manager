"use client";

import { useEffect, useMemo, useRef } from "react";
import Map, {
  Layer,
  Marker,
  NavigationControl,
  Source,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { Bed, Bus, MapPin, MapPinned, Sparkles } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import type { MapDestinationPinCategory } from "@/lib/trip/mapDestinationPinCategory";

export interface MapPin {
  id: string;
  lat: number;
  lon: number;
  title: string;
  category: MapDestinationPinCategory | "nearby";
  selected?: boolean;
  onClick?: () => void;
}

export interface MapRouteSegment {
  id: string;
  /** Ordered list of [lon, lat] pairs. */
  coordinates: [number, number][];
  color?: string;
}

interface MapLibreCanvasProps {
  pins: MapPin[];
  routes?: MapRouteSegment[];
  /** Auto-fit on mount. */
  initialBounds?: [[number, number], [number, number]] | null;
  /** Optional explicit center / zoom for initial view. */
  initialView?: { lat: number; lon: number; zoom: number };
  /** After interactions (e.g. pin tap), gently ease the map to this point. */
  focusPin?: { lat: number; lon: number } | null;
  className?: string;
  styleUrl?: string;
  showRoutes?: boolean;
}

const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    "osm-raster": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm-raster-layer",
      type: "raster",
      source: "osm-raster",
    },
  ],
} as unknown as maplibregl.StyleSpecification;

import type maplibregl from "maplibre-gl";

/** Degenerate bounds (single point or near-zero area) make fitBounds zoom to max — pad in degrees. */
const MIN_SPAN_DEG = 0.06;
/** Slightly extra bottom room when a bottom overlay (pin card) may cover the map. */
const EDGE_FIT_PADDING = { top: 52, bottom: 100, left: 52, right: 52 };
const FIT_PADDING = { top: 56, bottom: 56, left: 56, right: 56 };
const FIT_MAX_ZOOM = 14;
const EDGE_FIT_MAX_ZOOM = 15;

/** GeoJSON hit layer id — wide invisible stroke so route legs are easy to tap. */
const ROUTE_HIT_LAYER_ID = "trip-routes-hit";

function normalizeBoundsForFit(
  bounds: [[number, number], [number, number]]
): [[number, number], [number, number]] {
  let [swLon, swLat] = bounds[0];
  let [neLon, neLat] = bounds[1];
  let latSpan = neLat - swLat;
  let lonSpan = neLon - swLon;
  if (latSpan < MIN_SPAN_DEG) {
    const pad = (MIN_SPAN_DEG - latSpan) / 2 + 0.01;
    swLat -= pad;
    neLat += pad;
    latSpan = neLat - swLat;
  }
  if (lonSpan < MIN_SPAN_DEG) {
    const pad = (MIN_SPAN_DEG - lonSpan) / 2 + 0.01;
    swLon -= pad;
    neLon += pad;
  }
  return [
    [swLon, swLat],
    [neLon, neLat],
  ];
}

function boundsFromLineString(coords: [number, number][]): [[number, number], [number, number]] | null {
  if (coords.length < 2) return null;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  if (!Number.isFinite(minLon)) return null;
  return normalizeBoundsForFit([
    [minLon, minLat],
    [maxLon, maxLat],
  ]);
}

export function MapLibreCanvas({
  pins,
  routes,
  initialBounds,
  initialView,
  focusPin,
  className,
  styleUrl,
  showRoutes = true,
}: MapLibreCanvasProps) {
  const mapRef = useRef<MapRef>(null);
  const mapLoadedRef = useRef(false);

  const mapStyleSource = styleUrl ?? process.env.NEXT_PUBLIC_MAPTILER_KEY
    ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`
    : null;

  const routeFeatures = useMemo(() => {
    return (routes ?? []).map((r) => ({
      type: "Feature" as const,
      properties: { id: r.id, color: r.color ?? "#7c3aed" },
      geometry: {
        type: "LineString" as const,
        coordinates: r.coordinates,
      },
    }));
  }, [routes]);

  const initial = useMemo(() => {
    if (initialView) {
      return { latitude: initialView.lat, longitude: initialView.lon, zoom: initialView.zoom };
    }
    if (pins.length > 0) {
      return { latitude: pins[0].lat, longitude: pins[0].lon, zoom: 8 };
    }
    return { latitude: 20, longitude: 0, zoom: 1.5 };
  }, [initialView, pins]);

  useEffect(() => {
    if (!focusPin || !mapLoadedRef.current || !mapRef.current) return;
    const map = mapRef.current.getMap();
    const z = map.getZoom();
    map.easeTo({
      center: [focusPin.lon, focusPin.lat],
      zoom: Math.min(Math.max(z, 12), 15),
      duration: 500,
      essential: true,
    });
  }, [focusPin?.lat, focusPin?.lon]);

  return (
    <div className={cn("relative h-full w-full overflow-hidden rounded-3xl border border-[var(--color-border)]", className)}>
      <Map
        ref={mapRef}
        initialViewState={initial}
        mapStyle={mapStyleSource ?? (FALLBACK_STYLE as never)}
        attributionControl={{ compact: true }}
        interactiveLayerIds={showRoutes && routeFeatures.length > 0 ? [ROUTE_HIT_LAYER_ID] : undefined}
        onClick={(e) => {
          if (!mapRef.current || !mapLoadedRef.current) return;
          const hit = e.features?.find((f) => f.layer?.id === ROUTE_HIT_LAYER_ID);
          const geom = hit?.geometry;
          if (!geom || geom.type !== "LineString") return;
          const coords = geom.coordinates as [number, number][];
          const b = boundsFromLineString(coords);
          if (!b) return;
          mapRef.current.fitBounds(b, {
            padding: EDGE_FIT_PADDING,
            duration: 550,
            maxZoom: EDGE_FIT_MAX_ZOOM,
          });
        }}
        onLoad={() => {
          mapLoadedRef.current = true;
          if (initialBounds && mapRef.current) {
            const b = normalizeBoundsForFit(initialBounds);
            mapRef.current.fitBounds(b, {
              padding: FIT_PADDING,
              duration: 0,
              maxZoom: FIT_MAX_ZOOM,
            });
          }
        }}
      >
        <NavigationControl position="top-right" />
        {showRoutes && routeFeatures.length > 0 ? (
          <Source
            id="trip-routes"
            type="geojson"
            data={{ type: "FeatureCollection", features: routeFeatures }}
          >
            <Layer
              id="trip-routes-line"
              type="line"
              paint={{
                "line-color": ["get", "color"],
                "line-width": 3,
                "line-opacity": 0.85,
                "line-blur": 0.4,
              }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
            <Layer
              id="trip-routes-glow"
              type="line"
              paint={{
                "line-color": ["get", "color"],
                "line-width": 12,
                "line-opacity": 0.12,
                "line-blur": 6,
              }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
            <Layer
              id={ROUTE_HIT_LAYER_ID}
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-width": 22,
                "line-opacity": 0,
              }}
            />
          </Source>
        ) : null}

        {pins.map((p) => (
          <Marker
            key={p.id}
            longitude={p.lon}
            latitude={p.lat}
            anchor="bottom"
            style={{ zIndex: p.selected ? 2 : 1 }}
          >
            <PinView pin={p} onPress={() => p.onClick?.()} />
          </Marker>
        ))}
      </Map>
    </div>
  );
}

function PinView({ pin, onPress }: { pin: MapPin; onPress?: () => void }) {
  const Icon =
    pin.category === "hotel"
      ? Bed
      : pin.category === "transit"
        ? Bus
        : pin.category === "activity"
          ? Sparkles
          : pin.category === "nearby"
            ? MapPin
            : MapPinned;
  const color =
    pin.category === "hotel"
      ? "#7c3aed"
      : pin.category === "transit"
        ? "#0ea5e9"
        : pin.category === "activity"
          ? "#10b981"
          : pin.category === "stayArea"
            ? "#0e7490"
            : pin.category === "nearby"
              ? "#f97316"
              : pin.category === "place"
                ? "#0369a1"
                : "#0369a1";
  return (
    <button
      type="button"
      title={pin.title}
      className={cn(
        "touch-manipulation cursor-pointer flex flex-col items-center text-white transition-transform pointer-events-auto",
        pin.selected ? "scale-110" : "hover:scale-105 active:scale-95"
      )}
      style={{ touchAction: "manipulation" }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onPress?.();
      }}
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full shadow-lg ring-2 ring-white"
        style={{ backgroundColor: color }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span
        aria-hidden
        className="mt-[-4px] h-3 w-3 rotate-45"
        style={{ backgroundColor: color }}
      />
    </button>
  );
}
