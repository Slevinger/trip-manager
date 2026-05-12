"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { MapPin, Search, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useTripData } from "@/lib/trip/useTripData";
import { TripLoadStateScreen } from "@/components/screens/_shared/TripLoadStateScreen";
import { TripBackToTripLink } from "@/components/screens/_shared/TripSubpageBackLink";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty";
import { Switch } from "@/components/ui/switch";
import { IconButton } from "@/components/ui/icon-button";
import { coordsFromDestination } from "@/lib/tripDestinationGeo";
import { destinationMapPinCategory, type MapDestinationPinCategory } from "@/lib/trip/mapDestinationPinCategory";
import { transitIntervalsToMapEdges } from "@/lib/tripMapGeometry";
import { sortTripStepsByStartTime } from "@/lib/tripStepSort";
import type { MessageKey } from "@/lib/i18n/messages";
import type { TransitStep, Trip, TripLiveLocation } from "@/lib/types/trip";
import type { PlaceSearchHit } from "@/lib/places/types";
import type { MapPin as MapPinType, MapRouteSegment } from "@/components/map/MapLibreCanvas";

const MapLibreCanvas = dynamic(
  () => import("@/components/map/MapLibreCanvas").then((m) => ({ default: m.MapLibreCanvas })),
  { ssr: false, loading: () => <Skeleton className="h-full w-full rounded-3xl" /> }
);

const PIN_KIND_LABEL: Record<MapDestinationPinCategory, MessageKey> = {
  hotel: "mapview.pinKind.hotel",
  transit: "mapview.pinKind.transit",
  stayArea: "mapview.pinKind.area",
  activity: "mapview.pinKind.activity",
  place: "mapview.pinKind.place",
};

function pinKindBadgeTone(cat: MapDestinationPinCategory): "brand" | "mint" | "sky" | "amber" | "neutral" {
  switch (cat) {
    case "hotel":
      return "brand";
    case "activity":
      return "mint";
    case "transit":
      return "sky";
    case "stayArea":
      return "amber";
    default:
      return "neutral";
  }
}

export function MapScreen({ tripId }: { tripId: string }) {
  const { trip, loadState } = useTripData(tripId);
  if (loadState !== "ok" || !trip) return <TripLoadStateScreen state={loadState} />;
  return <MapContent trip={trip} />;
}

type MapPinSelection =
  | { kind: "destination"; id: string }
  | { kind: "nearby"; hit: PlaceSearchHit }
  | { kind: "traveler"; key: string }
  | null;

function liveTravelerLabel(trip: Trip, participantKey: string, loc: TripLiveLocation): string {
  const name = loc.name?.trim();
  if (name) return name;
  const k = participantKey.trim().toLowerCase();
  const tr = trip.travelers.find((x) => x.email?.trim().toLowerCase() === k);
  if (tr?.name?.trim()) return tr.name.trim();
  const vw = trip.viewers?.find((x) => x.email?.trim().toLowerCase() === k);
  if (vw?.name?.trim()) return vw.name.trim();
  return participantKey.includes("@") ? participantKey.split("@")[0]! : participantKey;
}

function MapContent({ trip }: { trip: Trip }) {
  const { t } = useI18n();
  const [pinSelection, setPinSelection] = useState<MapPinSelection>(null);
  const [showRoutes, setShowRoutes] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<PlaceSearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const pinned = useMemo<MapPinType[]>(() => {
    const pins: MapPinType[] = [];
    for (const d of trip.destinations) {
      const c = coordsFromDestination(d);
      if (!c) continue;
      const category = destinationMapPinCategory(trip, d.id);
      pins.push({
        id: `dest:${d.id}`,
        lat: c.lat,
        lon: c.lng,
        title: d.title,
        category,
        selected: pinSelection?.kind === "destination" && pinSelection.id === d.id,
        onClick: () => setPinSelection({ kind: "destination", id: d.id }),
      });
    }
    for (const hit of searchHits) {
      pins.push({
        id: `nearby:${hit.id}`,
        lat: hit.lat,
        lon: hit.lng,
        title: hit.title || hit.label,
        category: "nearby",
        selected: pinSelection?.kind === "nearby" && pinSelection.hit.id === hit.id,
        onClick: () => setPinSelection({ kind: "nearby", hit }),
      });
    }
    const live = trip.liveLocations ?? {};
    for (const [key, raw] of Object.entries(live)) {
      const loc = raw as TripLiveLocation;
      if (!loc || typeof loc.lat !== "number" || typeof loc.lon !== "number") continue;
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) continue;
      pins.push({
        id: `live:${key}`,
        lat: loc.lat,
        lon: loc.lon,
        title: liveTravelerLabel(trip, key, loc),
        category: "traveler",
        selected: pinSelection?.kind === "traveler" && pinSelection.key === key,
        onClick: () => setPinSelection({ kind: "traveler", key }),
      });
    }
    return pins;
  }, [trip, pinSelection, searchHits]);

  const focusPin = useMemo(() => {
    if (!pinSelection) return null;
    if (pinSelection.kind === "destination") {
      const d = trip.destinations.find((x) => x.id === pinSelection.id);
      const c = d ? coordsFromDestination(d) : null;
      return c ? { lat: c.lat, lon: c.lng } : null;
    }
    if (pinSelection.kind === "traveler") {
      const loc = trip.liveLocations?.[pinSelection.key];
      if (!loc || typeof loc.lat !== "number" || typeof loc.lon !== "number") return null;
      return { lat: loc.lat, lon: loc.lon };
    }
    return { lat: pinSelection.hit.lat, lon: pinSelection.hit.lng };
  }, [pinSelection, trip.destinations, trip.liveLocations]);

  const selectedDestination =
    pinSelection?.kind === "destination"
      ? trip.destinations.find((d) => d.id === pinSelection.id)
      : null;

  const routes = useMemo<MapRouteSegment[]>(() => {
    if (!showRoutes) return [];
    const sorted = sortTripStepsByStartTime(trip.steps);
    const segments: MapRouteSegment[] = [];
    for (const step of sorted) {
      if (step.stepType !== "transit") continue;
      const tr = step as TransitStep;
      if (!tr.stepIntervals.some((int) => int.intervalType === "transit")) continue;
      const edges = transitIntervalsToMapEdges(tr, trip.destinations);
      for (const e of edges) {
        segments.push({
          id: `transit:${tr.id}:${e.intervalId}`,
          coordinates: [
            [e.from.lng, e.from.lat],
            [e.to.lng, e.to.lat],
          ],
          color: "#0ea5e9",
        });
      }
    }
    return segments;
  }, [trip, showRoutes]);

  const initialBounds = useMemo<[[number, number], [number, number]] | null>(() => {
    if (pinned.length === 0) return null;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const p of pinned) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon);
      maxLon = Math.max(maxLon, p.lon);
    }
    return [
      [minLon, minLat],
      [maxLon, maxLat],
    ];
  }, [pinned]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 3) {
      setSearchHits([]);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    void (async () => {
      try {
        const url = new URL("/api/places/search", window.location.origin);
        url.searchParams.set("q", q);
        const res = await fetch(url.toString(), { signal: ctrl.signal });
        const json = (await res.json().catch(() => ({}))) as { hits?: PlaceSearchHit[] };
        setSearchHits(Array.isArray(json.hits) ? json.hits.slice(0, 6) : []);
      } catch {
        /* swallow */
      } finally {
        setSearching(false);
      }
    })();
    return () => ctrl.abort();
  }, [searchQuery]);

  const placesWithCoords = trip.destinations.filter((d) => coordsFromDestination(d));
  const placesWithoutCoords = trip.destinations.filter((d) => !coordsFromDestination(d));

  return (
    <div className="mx-auto box-border min-h-0 min-w-0 max-w-full space-y-4 px-4 py-6 lg:max-w-[120rem] lg:px-8">
      <TripBackToTripLink tripId={trip.id} />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <aside
        id="map-side-panel"
        className="order-2 min-w-0 space-y-4 lg:order-none"
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[var(--color-brand)]" /> {t("mapview.places")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {placesWithCoords.length === 0 ? (
              <EmptyState
                icon={<MapPin className="h-6 w-6" />}
                title={t("mapview.empty")}
                className="py-6"
              />
            ) : (
              <ul className="space-y-1.5">
                {placesWithCoords.map((d) => {
                  const cat = destinationMapPinCategory(trip, d.id);
                  const tone =
                    cat === "hotel" || cat === "stayArea"
                      ? "brand"
                      : cat === "activity"
                        ? "mint"
                        : "sky";
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => setPinSelection({ kind: "destination", id: d.id })}
                        className={
                          "flex w-full items-center justify-between gap-2 rounded-2xl px-2.5 py-2 text-left text-sm transition-colors " +
                          (pinSelection?.kind === "destination" && pinSelection.id === d.id
                            ? "bg-[var(--color-brand-soft)] text-[var(--color-foreground)]"
                            : "hover:bg-[var(--color-surface-muted)]")
                        }
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{d.title}</span>
                          {d.location ? (
                            <span className="block truncate text-[11px] text-[var(--color-muted-foreground)]">
                              {d.location}
                            </span>
                          ) : null}
                        </span>
                        <Badge tone={tone}>{cat}</Badge>
                      </button>
                    </li>
                  );
                })}
                {placesWithoutCoords.length > 0 ? (
                  <p className="px-2 pt-2 text-[11px] text-[var(--color-muted-foreground)]">
                    {placesWithoutCoords.length} more without coordinates.
                  </p>
                ) : null}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--color-accent-coral)]" /> {t("mapview.nearby")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("mapview.searchPlaceholder")}
                className="pl-8"
              />
            </div>
            {searching ? (
              <p className="text-xs text-[var(--color-muted-foreground)]">{t("mapview.searching")}</p>
            ) : searchHits.length > 0 ? (
              <ul className="space-y-1.5">
                {searchHits.map((hit) => (
                  <li
                    key={hit.id}
                    className="flex items-center justify-between gap-2 rounded-2xl bg-[var(--color-surface-muted)] px-2.5 py-2 text-xs"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{hit.title || hit.label}</span>
                      {hit.description ? (
                        <span className="block truncate text-[10px] text-[var(--color-muted-foreground)]">
                          {hit.description}
                        </span>
                      ) : null}
                    </span>
                    <Badge tone="coral">{hit.provider ?? "osm"}</Badge>
                  </li>
                ))}
              </ul>
            ) : searchQuery.trim().length >= 3 ? (
              <p className="text-xs text-[var(--color-muted-foreground)]">{t("mapview.noNearby")}</p>
            ) : (
              <p className="text-xs text-[var(--color-muted-foreground)]">{t("mapview.subheading")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-sm font-medium">
                {showRoutes ? t("mapview.routeOn") : t("mapview.routeOff")}
              </p>
              <p className="text-[11px] text-[var(--color-muted-foreground)]">
                {t("mapview.subheading")}
              </p>
            </div>
            <Switch checked={showRoutes} onCheckedChange={setShowRoutes} />
          </CardContent>
        </Card>
      </aside>

      <section className="relative order-1 h-[min(78dvh,32rem)] min-h-[16rem] min-w-0 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)] lg:order-none lg:h-[80vh] lg:min-h-[28rem]">
        {pinned.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<MapPin className="h-7 w-7" />}
              title={t("mapview.empty")}
              action={
                <Button asChild variant="secondary">
                  <a href={`/trip/${trip.id}/manage`}>{t("shell.manage")}</a>
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <MapLibreCanvas
              pins={pinned}
              routes={routes}
              initialBounds={initialBounds}
              focusPin={focusPin}
              showRoutes={showRoutes}
              className="h-full w-full"
            />
            {pinSelection ? (
              <div className="pointer-events-auto absolute inset-x-2 bottom-2 z-20 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/95 p-3 shadow-[var(--shadow-pop)] backdrop-blur-md sm:inset-x-3 sm:bottom-3 sm:p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--color-foreground)]">
                      {pinSelection.kind === "destination"
                        ? selectedDestination?.title ?? t("mapview.places")
                        : pinSelection.kind === "traveler"
                          ? trip.liveLocations?.[pinSelection.key]
                            ? liveTravelerLabel(
                                trip,
                                pinSelection.key,
                                trip.liveLocations[pinSelection.key]!
                              )
                            : t("mapview.pinKind.traveler")
                          : pinSelection.hit.title || pinSelection.hit.label}
                    </p>
                    {pinSelection.kind === "destination" && selectedDestination?.location ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-muted-foreground)]">
                        {selectedDestination.location}
                      </p>
                    ) : pinSelection.kind === "nearby" ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-muted-foreground)]">
                        {pinSelection.hit.description || pinSelection.hit.label}
                      </p>
                    ) : pinSelection.kind === "traveler" && trip.liveLocations?.[pinSelection.key] ? (
                      <p className="mt-0.5 line-clamp-3 text-xs text-[var(--color-muted-foreground)]">
                        {(() => {
                          const loc = trip.liveLocations[pinSelection.key]!;
                          const t0 = Date.parse(loc.updatedAt);
                          const min = Number.isFinite(t0)
                            ? Math.max(0, Math.round((Date.now() - t0) / 60_000))
                            : NaN;
                          const when = !Number.isFinite(t0)
                            ? loc.updatedAt
                            : min < 1
                              ? t("collab.justNow")
                              : min < 60
                                ? t("collab.minutesAgo", { minutes: min })
                                : new Date(t0).toLocaleString(undefined, {
                                    dateStyle: "short",
                                    timeStyle: "short",
                                  });
                          return `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} — ${t("mapview.liveTravelerHint")} — ${t("mapview.liveTravelerUpdated", { when })}`;
                        })()}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {pinSelection.kind === "destination" && selectedDestination ? (
                        <Badge
                          tone={pinKindBadgeTone(
                            destinationMapPinCategory(trip, selectedDestination.id)
                          )}
                        >
                          {t(
                            PIN_KIND_LABEL[destinationMapPinCategory(trip, selectedDestination.id)]
                          )}
                        </Badge>
                      ) : pinSelection.kind === "traveler" ? (
                        <Badge tone="coral">{t("mapview.pinKind.traveler")}</Badge>
                      ) : (
                        <Badge tone="coral">{t("mapview.nearby")}</Badge>
                      )}
                      {pinSelection.kind === "destination" ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="lg:hidden"
                          onClick={() =>
                            document
                              .getElementById("map-side-panel")
                              ?.scrollIntoView({ behavior: "smooth", block: "start" })
                          }
                        >
                          {t("mapview.goToList")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <IconButton
                    label={t("common.close")}
                    size="sm"
                    variant="ghost"
                    onClick={() => setPinSelection(null)}
                  >
                    <X className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>
      </div>
    </div>
  );
}
