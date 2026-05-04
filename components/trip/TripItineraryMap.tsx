"use client";

import L from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import { useI18n } from "@/lib/i18n/context";
import type { CurrentStepFocus } from "@/lib/tripViewPhase";
import {
  bearingDegreesNorth,
  collectDestinationListPins,
  collectStayAreaCircles,
  collectStaysByPinDestination,
  collectTransitMapEdges,
  focusStepLatLng,
  interpolateLatLng,
  TRANSIT_EDGE_LABEL_NEXT_LEG,
  TRANSIT_EDGE_LABEL_PRIOR_LEG,
  type DestinationListPin,
  type LatLng,
  type StayAreaCircle,
  type StayMapPoint,
  type TransitMapEdge,
} from "@/lib/tripMapGeometry";
import { intlLocaleForApp, type MessageKey } from "@/lib/i18n/messages";
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

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() ?? "";
const HAS_MAPTILER = MAPTILER_KEY.length > 0;
const MAP_TILE_URL = HAS_MAPTILER
  ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}&language=en`
  : "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png";
const MAP_TILE_ATTRIBUTION = HAS_MAPTILER
  ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>'
  : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

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

function formatStepWindow(
  isoStart: string,
  isoEnd: string | undefined,
  empty: string,
  intlLocale: string
): string {
  const a = new Date(isoStart);
  const b = isoEnd ? new Date(isoEnd) : null;
  if (Number.isNaN(a.getTime())) return empty;
  const opt: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  if (!b || Number.isNaN(b.getTime())) return a.toLocaleString(intlLocale, opt);
  return `${a.toLocaleString(intlLocale, opt)} → ${b.toLocaleString(intlLocale, opt)}`;
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function resolveTransitEndpointLabel(raw: string, t: Translate): string {
  if (raw === TRANSIT_EDGE_LABEL_PRIOR_LEG) return t("map.transitEdgePriorLeg");
  if (raw === TRANSIT_EDGE_LABEL_NEXT_LEG) return t("map.transitEdgeNextLeg");
  return raw;
}

function transitLegDurationLabel(t: Translate, startIso: string, endIso: string): string | null {
  const a = Date.parse(startIso);
  const b = Date.parse(endIso);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  const totalMins = Math.round((b - a) / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return t("map.transitDurationMinutes", { minutes: m });
  if (m === 0) return t("map.transitDurationHours", { hours: h });
  return t("map.transitDurationHoursMinutes", { hours: h, minutes: m });
}

function TransitEdgeTooltipBody({ edge }: { edge: TransitMapEdge }) {
  const { t, locale } = useI18n();
  const intlLocale = intlLocaleForApp(locale);
  const dash = t("view.emDash");
  const fromL = resolveTransitEndpointLabel(edge.fromPlaceLabel, t);
  const toL = resolveTransitEndpointLabel(edge.toPlaceLabel, t);
  const duration = transitLegDurationLabel(t, edge.startTime, edge.endTime);
  return (
    <div className="max-w-[min(280px,85vw)] space-y-1 text-left text-[11px] leading-snug text-zinc-600 dark:text-zinc-300">
      <p className="font-semibold text-zinc-700 dark:text-zinc-100">{edge.title}</p>
      <p>
        <span className="text-zinc-700 dark:text-zinc-200">{fromL}</span>
        <span className="mx-1 text-zinc-400" aria-hidden>
          →
        </span>
        <span className="text-zinc-700 dark:text-zinc-200">{toL}</span>
      </p>
      <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
        {formatStepWindow(edge.startTime, edge.endTime, dash, intlLocale)}
      </p>
      {duration ? (
        <p className="text-[10px] font-medium text-zinc-600 dark:text-zinc-300">{duration}</p>
      ) : null}
    </div>
  );
}

function DestinationPinTooltipBody({
  pin,
  linkedStays,
}: {
  pin: DestinationListPin;
  linkedStays: StayMapPoint[];
}) {
  const { t, locale } = useI18n();
  const intlLocale = intlLocaleForApp(locale);
  const dash = t("view.emDash");
  const registryBlock = (
    <>
      <p className="font-semibold text-zinc-700 dark:text-zinc-100">{pin.title}</p>
      {pin.placeLabel && pin.placeLabel !== "—" ? (
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{pin.placeLabel}</p>
      ) : null}
    </>
  );

  if (linkedStays.length === 0) {
    return <div className="max-w-[220px] space-y-1 text-left">{registryBlock}</div>;
  }

  if (linkedStays.length === 1) {
    const s = linkedStays[0]!;
    return (
      <div className="max-w-[240px] space-y-1 text-left text-[11px] leading-snug text-zinc-600 dark:text-zinc-300">
        {registryBlock}
        <div className="border-t border-zinc-200 pt-1.5 dark:border-zinc-600">
          <p className="font-semibold text-zinc-700 dark:text-zinc-100">{s.title}</p>
          <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
            {formatStepWindow(s.startTime, s.endTime, dash, intlLocale)}
          </p>
          {s.placeLabel && s.placeLabel !== "—" ? (
            <p className="text-zinc-500 dark:text-zinc-400">{s.placeLabel}</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[260px] space-y-1.5 text-left text-[11px] leading-snug text-zinc-600 dark:text-zinc-300">
      {registryBlock}
      <ul className="max-h-48 space-y-1.5 overflow-y-auto border-t border-zinc-200 pt-1.5 dark:border-zinc-600">
        {linkedStays.map((s) => (
          <li
            key={`${s.stepId}:${s.intervalId ?? ""}`}
            className="border-b border-zinc-100 pb-1.5 last:border-0 last:pb-0 dark:border-zinc-700"
          >
            <p className="font-semibold text-zinc-700 dark:text-zinc-100">{s.title}</p>
            <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
              {formatStepWindow(s.startTime, s.endTime, dash, intlLocale)}
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

/** Skip drawing when projected radius exceeds this share of the shorter map edge (avoids blocking pins). */
const STAY_AREA_MAX_SCREEN_RADIUS_FRACTION = 0.42;

function stayCircleRadiusPixels(map: LeafletMap, center: LatLng, radiusMeters: number): number {
  const centerLL = L.latLng(center.lat, center.lng);
  const cos = Math.cos((center.lat * Math.PI) / 180);
  const dLat = radiusMeters / 111320;
  const dLng = cos > 1e-6 ? radiusMeters / (111320 * cos) : 0;
  const edgeLL = L.latLng(center.lat + dLat, center.lng + dLng);
  const pC = map.latLngToLayerPoint(centerLL);
  const pE = map.latLngToLayerPoint(edgeLL);
  return pC.distanceTo(pE);
}

function StayAreaCircleLayers({
  circles,
  touchPrimary,
  focusStepId,
}: {
  circles: StayAreaCircle[];
  touchPrimary: boolean;
  focusStepId: string | null;
}) {
  const { t } = useI18n();
  const map = useMap();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const bump = () => setRevision((r) => r + 1);
    map.on("zoomend", bump);
    map.on("moveend", bump);
    const el = map.getContainer();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => bump()) : null;
    ro?.observe(el);
    return () => {
      map.off("zoomend", bump);
      map.off("moveend", bump);
      ro?.disconnect();
    };
  }, [map]);

  const visible = useMemo(() => {
    const s = map.getSize();
    if (s.x < 16 || s.y < 16) return circles;
    const maxR = Math.min(s.x, s.y) * STAY_AREA_MAX_SCREEN_RADIUS_FRACTION;
    return circles.filter(
      (c) => stayCircleRadiusPixels(map, c.center, c.radiusMeters) <= maxR
    );
  }, [map, circles, revision]);

  return (
    <>
      {visible.map((c) => {
        const emphasized = focusStepId === c.stepId;
        return (
          <Circle
            key={`stay-area-${c.stepId}`}
            center={[c.center.lat, c.center.lng]}
            radius={c.radiusMeters}
            pathOptions={{
              color: emphasized ? "#5b21b6" : "#6d28d9",
              weight: emphasized ? 2 : 1,
              fillColor: "#8b5cf6",
              fillOpacity: emphasized ? 0.14 : 0.08,
              opacity: emphasized ? 0.85 : 0.65,
            }}
          >
            <MapOverlay
              touchPrimary={touchPrimary}
              tooltipOpacity={0.95}
              tooltipClassName="!rounded-lg !border !border-zinc-200 !bg-white !p-2 !text-[11px] !text-zinc-600 !shadow-md dark:!border-zinc-600 dark:!bg-zinc-900 dark:!text-zinc-300"
            >
              <div className="max-w-[min(280px,72vw)] space-y-1 text-left">
                <p className="font-semibold text-zinc-700 dark:text-zinc-100">{c.title}</p>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {t("map.stayAreaCircle")}
                </p>
                {c.placeLabel && c.placeLabel !== "—" ? (
                  <p className="text-zinc-500 dark:text-zinc-400">{c.placeLabel}</p>
                ) : null}
                <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                  {t("map.stayAreaCircleRadius", {
                    km: (c.radiusMeters / 1000).toFixed(2),
                  })}
                </p>
                {c.destinationsInArea.length > 0 ? (
                  <div className="border-t border-zinc-200 pt-1.5 dark:border-zinc-600">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      {t("map.stayAreaDestinationsHeading")}
                    </p>
                    <ul className="mt-1 max-h-[min(200px,40vh)] list-disc space-y-1 overflow-y-auto pl-3.5 text-[10px] text-zinc-700 dark:text-zinc-200">
                      {c.destinationsInArea.map((row, idx) => (
                        <li key={`${c.stepId}-d-${idx}`} className="marker:text-zinc-400">
                          <span className="font-medium">{row.title}</span>
                          {row.placeLine ? (
                            <span className="mt-0.5 block font-normal leading-snug text-zinc-500 dark:text-zinc-400">
                              {row.placeLine}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </MapOverlay>
          </Circle>
        );
      })}
    </>
  );
}

type TripLeafletMapInnerProps = {
  center: LatLng;
  allPoints: LatLng[];
  focusLatLng: LatLng | null;
  transitEdges: TransitMapEdge[];
  destinationPins: DestinationListPin[];
  stayAreaCircles: StayAreaCircle[];
  staysByPinDestination: Record<string, StayMapPoint[]>;
  focusStepId: string | null;
  focus: CurrentStepFocus;
  touchPrimary: boolean;
  /** When set, double-clicking a destination pin (or the focused activity pin) opens edit. */
  onDestinationDblClick?: (destinationId: string) => void;
};

/**
 * Key this component by trip id so `layersReady` resets per map instance (avoids attaching layers
 * before Leaflet panes exist — React 19 / Strict Mode appendChild races).
 */
function TripLeafletMapInner({
  center,
  allPoints,
  focusLatLng,
  transitEdges,
  destinationPins,
  stayAreaCircles,
  staysByPinDestination,
  focusStepId,
  focus,
  touchPrimary,
  onDestinationDblClick,
}: TripLeafletMapInnerProps) {
  const { t, locale } = useI18n();
  const intlLocale = intlLocaleForApp(locale);
  const [layersReady, setLayersReady] = useState(false);
  const layersArmCancelledRef = useRef(false);
  useEffect(() => {
    layersArmCancelledRef.current = false;
    return () => {
      layersArmCancelledRef.current = true;
    };
  }, []);

  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={11}
      className="h-full w-full [&_.leaflet-control-attribution]:text-[10px]"
      scrollWheelZoom
      /** Otherwise the second click of a double-click becomes map zoom instead of opening the destination editor. */
      doubleClickZoom={onDestinationDblClick ? false : true}
      whenReady={() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!layersArmCancelledRef.current) setLayersReady(true);
          });
        });
      }}
    >
      {layersReady ? (
        <>
          <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} />
          <MapFitBoundsOnDataChange points={allPoints} focus={focusLatLng} />
          <StayAreaCircleLayers
            circles={stayAreaCircles}
            touchPrimary={touchPrimary}
            focusStepId={focusStepId}
          />
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
                    tooltipClassName="!max-w-[min(280px,85vw)] !border !border-zinc-200 !bg-white !px-2 !py-1.5 !text-[11px] !text-zinc-600 !shadow-md dark:!border-zinc-600 dark:!bg-zinc-900 dark:!text-zinc-300"
                  >
                    <TransitEdgeTooltipBody edge={edge} />
                  </MapOverlay>
                </Polyline>
                <Marker position={[arrowPos.lat, arrowPos.lng]} icon={arrowDivIcon(bearing, color)}>
                  <MapOverlay
                    touchPrimary={touchPrimary}
                    tooltipOpacity={0.95}
                    tooltipClassName="!max-w-[min(280px,85vw)] !border !border-zinc-200 !bg-white !px-2 !py-1.5 !text-[11px] !text-zinc-600 !shadow-md dark:!border-zinc-600 dark:!bg-zinc-900 dark:!text-zinc-300"
                  >
                    <TransitEdgeTooltipBody edge={edge} />
                  </MapOverlay>
                </Marker>
              </Fragment>
            );
          })}
          {destinationPins.map((r) => {
            const linkedStays = staysByPinDestination[r.destinationId] ?? [];
            return (
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
                eventHandlers={
                  onDestinationDblClick
                    ? {
                        dblclick: (e) => {
                          const dom = e.originalEvent;
                          if (dom) {
                            L.DomEvent.stopPropagation(dom);
                            L.DomEvent.preventDefault(dom);
                          }
                          onDestinationDblClick(r.destinationId);
                        },
                      }
                    : undefined
                }
              >
                <MapOverlay
                  touchPrimary={touchPrimary}
                  tooltipOpacity={0.95}
                  tooltipClassName="!rounded-lg !border !border-zinc-200 !bg-white !p-2 !text-[11px] !text-zinc-600 !shadow-md dark:!border-zinc-600 dark:!bg-zinc-900 dark:!text-zinc-300"
                >
                  <DestinationPinTooltipBody pin={r} linkedStays={linkedStays} />
                </MapOverlay>
              </CircleMarker>
            );
          })}
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
              eventHandlers={
                onDestinationDblClick
                  ? {
                      dblclick: (e) => {
                        const dom = e.originalEvent;
                        if (dom) {
                          L.DomEvent.stopPropagation(dom);
                          L.DomEvent.preventDefault(dom);
                        }
                        const st = focus.step;
                        if (st.stepType !== "activity") return;
                        onDestinationDblClick(st.destinationId);
                      },
                    }
                  : undefined
              }
            >
              <MapOverlay
                touchPrimary={touchPrimary}
                tooltipOpacity={0.95}
                tooltipClassName="!rounded-lg !border !border-zinc-200 !bg-white !p-2 !text-xs !text-zinc-600 !shadow-md dark:!border-zinc-600 dark:!bg-zinc-900 dark:!text-zinc-300"
              >
                <div className="max-w-[220px] space-y-1 text-left">
                  <p className="font-semibold text-zinc-700 dark:text-zinc-100">
                    {(focus.step.title || t("view.defaultActivityTitle")).trim()}
                  </p>
                  <p className="font-mono text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                    {formatStepWindow(
                      focus.step.startTime,
                      focus.step.endTime,
                      t("view.emDash"),
                      intlLocale
                    )}
                  </p>
                </div>
              </MapOverlay>
            </CircleMarker>
          ) : null}
        </>
      ) : null}
    </MapContainer>
  );
}

export function TripItineraryMap({
  tripId,
  sortedSteps,
  destinations,
  focus,
  onDestinationDblClick,
}: {
  tripId: string;
  sortedSteps: TripStep[];
  destinations: Destination[];
  focus: CurrentStepFocus;
  onDestinationDblClick?: (destinationId: string) => void;
}) {
  const { t } = useI18n();
  const staysByPinDestination = useMemo((): Record<string, StayMapPoint[]> => {
    const m = collectStaysByPinDestination(sortedSteps, destinations);
    return Object.fromEntries(m);
  }, [sortedSteps, destinations]);
  const stayAreaCircles = useMemo(
    () => collectStayAreaCircles(sortedSteps, destinations),
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
    const pts: LatLng[] = [];
    for (const e of transitEdges) {
      pts.push(e.from, e.to);
    }
    for (const r of destinationPins) {
      pts.push(r.position);
    }
    return pts;
  }, [transitEdges, destinationPins]);

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
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t("map.noPinsTitle")}</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("map.noPinsBody")}</p>
      </section>
    );
  }

  const center =
    focusLatLng ??
    destinationPins[0]?.position ??
    transitEdges[0]?.from ??
    { lat: 0, lng: 0 };

  return (
    <section className="mt-8">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {t("map.routeMapTitle")}
      </h3>
      <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        {touchPrimary ? t("map.pinsGuideTap") : t("map.pinsGuideHover")}
        {onDestinationDblClick ? <> {t("map.destPinDblClickEdit")}</> : null}
      </p>
      <div className="relative z-0 min-h-[280px] h-[min(360px,55vh)] w-full overflow-hidden rounded-2xl border border-zinc-200 shadow-sm dark:border-zinc-700">
        {!domReady ? (
          <div className="flex h-full min-h-[inherit] items-center justify-center bg-zinc-100 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {t("map.preparingMap")}
          </div>
        ) : (
          <TripLeafletMapInner
            key={tripId}
            center={center}
            allPoints={allPoints}
            focusLatLng={focusLatLng}
            transitEdges={transitEdges}
            destinationPins={destinationPins}
            stayAreaCircles={stayAreaCircles}
            staysByPinDestination={staysByPinDestination}
            focusStepId={focusStepId}
            focus={focus}
            touchPrimary={touchPrimary}
            onDestinationDblClick={onDestinationDblClick}
          />
        )}
      </div>
    </section>
  );
}
