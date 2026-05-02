"use client";

import L from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { CurrentStepFocus } from "@/lib/tripViewPhase";
import {
  bearingDegreesNorth,
  clusterStayPointsScreen,
  collectDestinationListPins,
  collectStayMapPoints,
  collectTransitMapEdges,
  focusStepLatLng,
  interpolateLatLng,
  stayClusterPixelRadius,
  type LatLng,
  type StayCluster,
  type StayMapPoint,
} from "@/lib/tripMapGeometry";
import type { Destination, TripStep } from "@/lib/types/trip";

import "leaflet/dist/leaflet.css";

/** No hover capability → use tap (Popup) instead of hover tooltips. */
function useTouchPrimary(): boolean {
  const [touch, setTouch] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(hover: none)").matches : false
  );
  useLayoutEffect(() => {
    const mq = window.matchMedia("(hover: none)");
    const apply = () => setTouch(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return touch;
}

const MAP_OVERLAY_PANEL_INNER =
  "rounded-lg border border-zinc-200 bg-white p-2 text-left text-zinc-600 shadow-md dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300";

function MapOverlay({
  touchPrimary,
  tooltipClassName,
  tooltipOpacity,
  children,
}: {
  touchPrimary: boolean;
  tooltipClassName: string;
  tooltipOpacity?: number;
  children: React.ReactNode;
}) {
  if (touchPrimary) {
    return (
      <Popup
        keepInView
        closeButton
        autoPan
        autoPanPadding={[20, 20]}
        minWidth={160}
        className="trip-map-touch-popup"
      >
        <div className={MAP_OVERLAY_PANEL_INNER}>{children}</div>
      </Popup>
    );
  }
  return (
    <Tooltip
      sticky
      direction="top"
      opacity={tooltipOpacity ?? 0.98}
      className={tooltipClassName}
    >
      {children}
    </Tooltip>
  );
}

function arrowDivIcon(bearingDeg: number, color: string): L.DivIcon {
  return L.divIcon({
    className: "trip-map-arrow-marker",
    html: `<div class="trip-map-arrow-shape" style="transform:rotate(${bearingDeg}deg);--arrow-color:${color}"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function applyFitBounds(map: LeafletMap, points: LatLng[], focus: LatLng | null) {
  if (points.length === 0 && !focus) return;
  const list = focus ? [...points, focus] : [...points];
  if (list.length === 0) return;
  if (list.length === 1) {
    map.setView([list[0].lat, list[0].lng], 11, { animate: false });
    return;
  }
  const b = L.latLngBounds(list.map((p) => [p.lat, p.lng] as L.LatLngTuple));
  map.fitBounds(b, { padding: [32, 32], maxZoom: 12, animate: false });
}

function formatStepWindow(isoStart: string, isoEnd?: string): string {
  const a = new Date(isoStart);
  const b = isoEnd ? new Date(isoEnd) : null;
  if (Number.isNaN(a.getTime())) return "—";
  const opt: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  if (!b || Number.isNaN(b.getTime())) return a.toLocaleString(undefined, opt);
  return `${a.toLocaleString(undefined, opt)} → ${b.toLocaleString(undefined, opt)}`;
}

function StayClusterTooltipBody({ cluster }: { cluster: StayCluster }) {
  const { stays } = cluster;
  if (stays.length === 1) {
    const s = stays[0];
    return (
      <div className="max-w-[240px] space-y-1 text-left text-[11px] leading-snug text-zinc-600 dark:text-zinc-300">
        <p className="font-semibold text-zinc-700 dark:text-zinc-100">{s.title}</p>
        <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
          {formatStepWindow(s.startTime, s.endTime)}
        </p>
        {s.placeLabel && s.placeLabel !== "—" ? (
          <p className="text-zinc-500 dark:text-zinc-400">{s.placeLabel}</p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="max-w-[260px] space-y-1.5 text-left text-[11px] leading-snug text-zinc-600 dark:text-zinc-300">
      <p className="font-semibold text-zinc-700 dark:text-zinc-100">
        {stays.length} stays at this map pin
      </p>
      <ul className="max-h-48 space-y-1.5 overflow-y-auto border-t border-zinc-200 pt-1.5 dark:border-zinc-600">
        {stays.map((s) => (
          <li
            key={s.intervalId ?? s.stepId}
            className="border-b border-zinc-100 pb-1.5 last:border-0 last:pb-0 dark:border-zinc-700"
          >
            <p className="font-semibold text-zinc-700 dark:text-zinc-100">{s.title}</p>
            <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
              {formatStepWindow(s.startTime, s.endTime)}
            </p>
            {s.placeLabel && s.placeLabel !== "—" ? (
              <p className="text-zinc-500 dark:text-zinc-400">{s.placeLabel}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StayClustersLayer({
  stayPoints,
  focusStepId,
  touchPrimary,
}: {
  stayPoints: StayMapPoint[];
  focusStepId: string | null;
  touchPrimary: boolean;
}) {
  const map = useMap();
  const [clusters, setClusters] = useState<StayCluster[]>([]);

  const recluster = useCallback(() => {
    if (stayPoints.length === 0) {
      setClusters([]);
      return;
    }
    const px = stayClusterPixelRadius(map.getZoom());
    setClusters(clusterStayPointsScreen(map, stayPoints, px));
  }, [map, stayPoints]);

  useEffect(() => {
    const run = () => {
      requestAnimationFrame(() => recluster());
    };
    run();
    map.on("zoomend", run);
    map.on("moveend", run);
    return () => {
      map.off("zoomend", run);
      map.off("moveend", run);
    };
  }, [map, recluster]);

  return (
    <>
      {clusters.map((c) => {
        const clusterKey = c.stays
          .map((s) => `${s.stepId}:${s.intervalId ?? ""}`)
          .sort()
          .join("|");
        const isFocus = focusStepId != null && c.stays.some((s) => s.stepId === focusStepId);
        const count = c.stays.length;
        return (
          <CircleMarker
            key={clusterKey}
            center={[c.centroid.lat, c.centroid.lng]}
            radius={isFocus ? 13 : count > 1 ? 11 : 8}
            pathOptions={{
              color: isFocus ? "#5b21b6" : "#52525b",
              weight: count > 1 ? 3 : 2,
              fillColor: isFocus ? "#8b5cf6" : count > 1 ? "#c4b5fd" : "#a1a1aa",
              fillOpacity: 0.92,
            }}
          >
            <MapOverlay
              touchPrimary={touchPrimary}
              tooltipOpacity={0.98}
              tooltipClassName="!rounded-lg !border !border-zinc-200 !bg-white !p-2 !text-zinc-600 !shadow-lg dark:!border-zinc-600 dark:!bg-zinc-900 dark:!text-zinc-300"
            >
              <StayClusterTooltipBody cluster={c} />
            </MapOverlay>
          </CircleMarker>
        );
      })}
    </>
  );
}

/** Re-fit when trip data changes; defer one frame so tile panes exist (avoids appendChild errors). */
function MapFitBoundsOnDataChange({ points, focus }: { points: LatLng[]; focus: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      map.invalidateSize();
      applyFitBounds(map, points, focus);
    });
    return () => cancelAnimationFrame(id);
  }, [map, points, focus]);
  return null;
}

export function TripItineraryMap({
  sortedSteps,
  destinations,
  focus,
}: {
  sortedSteps: TripStep[];
  destinations: Destination[];
  focus: CurrentStepFocus;
}) {
  const stayPoints = useMemo(
    () => collectStayMapPoints(sortedSteps, destinations),
    [sortedSteps, destinations]
  );
  const transitEdges = useMemo(
    () => collectTransitMapEdges(sortedSteps, destinations),
    [sortedSteps, destinations]
  );
  const destinationPins = useMemo(
    () => collectDestinationListPins(destinations),
    [destinations]
  );
  const focusLatLng = useMemo(
    () => focusStepLatLng(focus, sortedSteps, destinations),
    [focus, sortedSteps, destinations]
  );
  const focusStepId = focus.kind !== "none" ? focus.step.id : null;

  const allPoints = useMemo(() => {
    const pts: LatLng[] = stayPoints.map((s) => s.position);
    for (const e of transitEdges) {
      pts.push(e.from, e.to);
    }
    for (const r of destinationPins) {
      pts.push(r.position);
    }
    return pts;
  }, [stayPoints, transitEdges, destinationPins]);

  /** Avoid mounting Leaflet until layout exists (fixes TileLayer / pane appendChild races with React 19). */
  const [domReady, setDomReady] = useState(false);
  useLayoutEffect(() => {
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setDomReady(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, []);

  const hasMap = allPoints.length > 0 || focusLatLng != null;
  const touchPrimary = useTouchPrimary();

  if (!hasMap) {
    return (
      <section className="mt-8 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/80 px-4 py-8 text-center dark:border-zinc-600 dark:bg-zinc-900/40">
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">No map pins yet</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Each destination appears here once it has saved coordinates (pick a place in{" "}
          <strong>Manage</strong>). Stay intervals and transit legs can add extra geometry; transit
          without leg pins still draws a straight connector between surrounding steps when possible.
        </p>
      </section>
    );
  }

  const center =
    focusLatLng ??
    stayPoints[0]?.position ??
    transitEdges[0]?.from ??
    destinationPins[0]?.position ??
    { lat: 0, lng: 0 };

  return (
    <section className="mt-8">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Route map
      </h3>
      <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        {touchPrimary ? "Tap" : "Hover"} pins for details. Teal markers are your saved destinations
        (one per list entry with coordinates). Purple/grey clusters are stay intervals; overlapping
        stay pins merge at this zoom — zoom in to split them.
      </p>
      <div className="relative z-0 min-h-[280px] h-[min(360px,55vh)] w-full overflow-hidden rounded-2xl border border-zinc-200 shadow-sm dark:border-zinc-700">
        {!domReady ? (
          <div className="flex h-full min-h-[inherit] items-center justify-center bg-zinc-100 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            Preparing map…
          </div>
        ) : (
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={11}
          className="h-full w-full [&_.leaflet-control-attribution]:text-[10px]"
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapFitBoundsOnDataChange points={allPoints} focus={focusLatLng} />
          {transitEdges.map((edge) => {
            const emphasized = focusStepId === edge.stepId;
            const bearing = bearingDegreesNorth(edge.from, edge.to);
            const arrowPos = interpolateLatLng(edge.from, edge.to, 0.88);
            const inferred = Boolean(edge.inferred);
            const color = inferred
              ? emphasized
                ? "#b91c1c"
                : "#ef4444"
              : emphasized
                ? "#7c3aed"
                : "#0ea5e9";
            const lineWeight = touchPrimary
              ? emphasized
                ? 8
                : 6
              : emphasized
                ? 5
                : 3;
            return (
              <Fragment key={`${edge.stepId}-${edge.intervalId}`}>
                <Polyline
                  pathOptions={{
                    color,
                    weight: lineWeight,
                    opacity: inferred ? 0.72 : 0.92,
                    dashArray: emphasized ? undefined : inferred ? "6 10" : "10 8",
                  }}
                  positions={[
                    [edge.from.lat, edge.from.lng],
                    [edge.to.lat, edge.to.lng],
                  ]}
                >
                  <MapOverlay
                    touchPrimary={touchPrimary}
                    tooltipOpacity={0.95}
                    tooltipClassName="!max-w-[220px] !border !border-zinc-200 !bg-white !px-2 !py-1.5 !text-[11px] !text-zinc-600 !shadow-md dark:!border-zinc-600 dark:!bg-zinc-900 dark:!text-zinc-300"
                  >
                    <span className="font-semibold text-zinc-700 dark:text-zinc-100">{edge.title}</span>
                  </MapOverlay>
                </Polyline>
                <Marker position={[arrowPos.lat, arrowPos.lng]} icon={arrowDivIcon(bearing, color)}>
                  <MapOverlay
                    touchPrimary={touchPrimary}
                    tooltipOpacity={0.95}
                    tooltipClassName="!border !border-zinc-200 !bg-white !px-2 !py-1.5 !text-xs !font-semibold !text-zinc-700 !shadow-md dark:!border-zinc-600 dark:!bg-zinc-900 dark:!text-zinc-100"
                  >
                    {edge.title}
                  </MapOverlay>
                </Marker>
              </Fragment>
            );
          })}
          {destinationPins.map((r) => (
            <CircleMarker
              key={`destination-${r.destinationId}`}
              center={[r.position.lat, r.position.lng]}
              radius={7}
              pathOptions={{
                color: "#0f766e",
                weight: 2,
                fillColor: "#5eead4",
                fillOpacity: 0.35,
              }}
            >
              <MapOverlay
                touchPrimary={touchPrimary}
                tooltipOpacity={0.95}
                tooltipClassName="!rounded-lg !border !border-zinc-200 !bg-white !p-2 !text-[11px] !text-zinc-600 !shadow-md dark:!border-zinc-600 dark:!bg-zinc-900 dark:!text-zinc-300"
              >
                <div className="max-w-[220px] space-y-1 text-left">
                  <p className="font-semibold text-zinc-700 dark:text-zinc-100">{r.title}</p>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Destination</p>
                  {r.placeLabel && r.placeLabel !== "—" ? (
                    <p className="text-zinc-500 dark:text-zinc-400">{r.placeLabel}</p>
                  ) : null}
                </div>
              </MapOverlay>
            </CircleMarker>
          ))}
          <StayClustersLayer
            stayPoints={stayPoints}
            focusStepId={focusStepId}
            touchPrimary={touchPrimary}
          />
          {focusLatLng &&
          focusStepId &&
          focus.kind !== "none" &&
          focus.step.stepType === "activity" ? (
            <CircleMarker
              center={[focusLatLng.lat, focusLatLng.lng]}
              radius={10}
              pathOptions={{
                color: "#047857",
                weight: 2,
                fillColor: "#10b981",
                fillOpacity: 0.85,
              }}
            >
              <MapOverlay
                touchPrimary={touchPrimary}
                tooltipOpacity={0.95}
                tooltipClassName="!rounded-lg !border !border-zinc-200 !bg-white !p-2 !text-xs !text-zinc-600 !shadow-md dark:!border-zinc-600 dark:!bg-zinc-900 dark:!text-zinc-300"
              >
                <div className="max-w-[220px] space-y-1 text-left">
                  <p className="font-semibold text-zinc-700 dark:text-zinc-100">
                    {(focus.step.title || "Activity").trim()}
                  </p>
                  <p className="font-mono text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                    {formatStepWindow(focus.step.startTime, focus.step.endTime)}
                  </p>
                </div>
              </MapOverlay>
            </CircleMarker>
          ) : null}
        </MapContainer>
        )}
      </div>
    </section>
  );
}
