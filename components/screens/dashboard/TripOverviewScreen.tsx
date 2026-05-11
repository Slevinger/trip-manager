"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CalendarRange,
  CloudSun,
  ListChecks,
  Loader2,
  Map as MapIcon,
  MessagesSquare,
  RefreshCw,
  Settings2,
  Users,
  Wallet,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useTripData } from "@/lib/trip/useTripData";
import { fetchTripHeroCoverFromApi } from "@/lib/trip/heroCoverClient";
import { heroCoverImageSrc } from "@/lib/trip/heroCoverDisplayUrl";
import { cn } from "@/lib/ui/cn";
import { useTripWeather, weatherCodeIcon } from "@/lib/weather/useTripWeather";
import { tripDestinationCentroid } from "@/lib/trip/tripCentroid";
import { Avatar, AvatarFallback, AvatarImage, avatarInitials } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyState } from "@/components/ui/empty";
import { InlineAgentSuggestions } from "@/components/agent/InlineAgentSuggestions";
import { TripLoadStateScreen } from "@/components/screens/_shared/TripLoadStateScreen";
import { TripBackToTripsHubLink } from "@/components/screens/_shared/TripSubpageBackLink";
import {
  formatDurationMs,
  getTripViewPhase,
  msUntilTripStart,
  tripInstantMs,
  tripTotalDurationMs,
} from "@/lib/tripViewPhase";
import type { Traveler, Trip, TripViewer } from "@/lib/types/trip";

function formatRange(startIso: string, endIso: string): string {
  const a = tripInstantMs(startIso);
  const b = tripInstantMs(endIso);
  if (a == null || b == null) return "—";
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${fmt.format(new Date(a))} → ${fmt.format(new Date(b))}`;
}

type TripWeatherRow = {
  dateIso: string;
  tempMaxC: number;
  tempMinC: number;
  weatherCode: number;
  source: "forecast" | "historical" | "none";
};

function eachTripDayIso(startIso: string, endIso: string): string[] {
  const s = startIso.slice(0, 10);
  const e = endIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e) || e < s) return [];
  const out: string[] = [];
  let cur = s;
  let guard = 0;
  while (cur <= e && guard < 400) {
    out.push(cur);
    const [y, m, d] = cur.split("-").map((x) => Number.parseInt(x, 10));
    cur = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    guard += 1;
  }
  return out;
}

function buildTripWeatherRows(
  trip: Trip,
  weather: ReturnType<typeof useTripWeather>
): TripWeatherRow[] {
  const dates = eachTripDayIso(trip.startDate, trip.endDate);
  const fc = new Map((weather.daily ?? []).map((d) => [d.dateIso.slice(0, 10), d] as const));
  const hi = new Map(
    (weather.tripHistorical?.daily ?? []).map((d) => [d.dateIso.slice(0, 10), d] as const)
  );
  return dates.map((dateIso) => {
    const f = fc.get(dateIso);
    if (f && Number.isFinite(f.tempMaxC) && Number.isFinite(f.tempMinC)) {
      return {
        dateIso,
        tempMaxC: f.tempMaxC,
        tempMinC: f.tempMinC,
        weatherCode: f.weatherCode,
        source: "forecast" as const,
      };
    }
    const h = hi.get(dateIso);
    if (h && Number.isFinite(h.tempMaxC) && Number.isFinite(h.tempMinC)) {
      return {
        dateIso,
        tempMaxC: h.tempMaxC,
        tempMinC: h.tempMinC,
        weatherCode: h.weatherCode,
        source: "historical" as const,
      };
    }
    return {
      dateIso,
      tempMaxC: Number.NaN,
      tempMinC: Number.NaN,
      weatherCode: 0,
      source: "none" as const,
    };
  });
}

export function TripOverviewScreen({ tripId }: { tripId: string }) {
  const { trip, loadState, persistTrip, canManage } = useTripData(tripId);

  if (loadState !== "ok" || !trip) {
    return <TripLoadStateScreen state={loadState} />;
  }

  return <TripOverviewContent trip={trip} persistTrip={persistTrip} canManage={canManage} />;
}

function TripOverviewContent({
  trip,
  persistTrip,
  canManage,
}: {
  trip: Trip;
  persistTrip: (next: Trip) => Promise<void>;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const nowMs = Date.now();
  const phase = getTripViewPhase(trip, nowMs);
  const untilStart = msUntilTripStart(trip, nowMs);
  const totalMs = tripTotalDurationMs(trip);
  const weather = useTripWeather(trip);
  const weatherCentroid = useMemo(() => tripDestinationCentroid(trip), [trip]);
  const tripWeatherRows = useMemo(() => buildTripWeatherRows(trip, weather), [trip, weather]);
  const hasForecastChip = tripWeatherRows.some((r) => r.source === "forecast");
  const hasHistoricalChip = tripWeatherRows.some((r) => r.source === "historical");
  const proxyYear = weather.tripHistorical?.proxyYear;
  const showMixedCaption =
    hasForecastChip && hasHistoricalChip && proxyYear != null && Number.isFinite(proxyYear);
  const showFullHistoricalCaption =
    hasHistoricalChip && !hasForecastChip && proxyYear != null && Number.isFinite(proxyYear);

  const collaborators: Array<Traveler | TripViewer> = [
    ...trip.travelers,
    ...(trip.viewers ?? []),
  ];

  const tripRef = useRef(trip);
  tripRef.current = trip;
  const persistRef = useRef(persistTrip);
  persistRef.current = persistTrip;
  const autoHeroAttemptedRef = useRef(false);
  const [heroBusy, setHeroBusy] = useState(false);
  const [heroCoverError, setHeroCoverError] = useState<string | null>(null);
  const [heroImageFailed, setHeroImageFailed] = useState(false);

  const coverUrl = trip.heroCover?.url?.trim();
  const proxiedCoverSrc = coverUrl ? heroCoverImageSrc(coverUrl) : "";
  const [imgShownSrc, setImgShownSrc] = useState(() => proxiedCoverSrc || coverUrl || "");

  const formatHeroCoverErr = (e: unknown) => {
    const msg =
      e instanceof Error && e.message.trim()
        ? e.message.trim()
        : t("tripHero.heroCoverFailed");
    return msg.length > 420 ? `${msg.slice(0, 420)}…` : msg;
  };

  useEffect(() => {
    setImgShownSrc(proxiedCoverSrc || coverUrl || "");
    setHeroImageFailed(false);
  }, [coverUrl, proxiedCoverSrc]);

  useEffect(() => {
    autoHeroAttemptedRef.current = false;
  }, [trip.id]);

  useEffect(() => {
    if (!canManage || trip.destinations.length === 0 || coverUrl || autoHeroAttemptedRef.current) return;
    autoHeroAttemptedRef.current = true;
    const ac = new AbortController();
    void (async () => {
      try {
        const partial = await fetchTripHeroCoverFromApi(tripRef.current, ac.signal);
        const now = new Date().toISOString();
        await persistRef.current({
          ...tripRef.current,
          heroCover: { ...partial, updatedAt: now },
          updatedAt: now,
        });
        setHeroCoverError(null);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        autoHeroAttemptedRef.current = false;
        setHeroCoverError(formatHeroCoverErr(e));
      }
    })();
    return () => ac.abort();
  }, [canManage, trip.id, coverUrl, trip.destinations.length]);

  async function refreshHeroCover() {
    if (!canManage || trip.destinations.length === 0) return;
    setHeroBusy(true);
    setHeroCoverError(null);
    try {
      const partial = await fetchTripHeroCoverFromApi(tripRef.current);
      const now = new Date().toISOString();
      await persistRef.current({
        ...tripRef.current,
        heroCover: { ...partial, updatedAt: now },
        updatedAt: now,
      });
    } catch (e) {
      setHeroCoverError(formatHeroCoverErr(e));
    } finally {
      setHeroBusy(false);
    }
  }

  const heroGradient =
    phase === "during"
      ? "bg-gradient-meadow"
      : phase === "after_end"
        ? "bg-gradient-aurora"
        : "bg-gradient-brand";

  const heroLabel =
    phase === "during"
      ? t("tripHero.runningTitle")
      : phase === "after_end"
        ? t("tripHero.endedTitle")
        : untilStart != null
          ? t("tripHero.countdownTitle", {
              days: Math.max(0, Math.floor(untilStart / (24 * 3600 * 1000))),
              hours: Math.max(0, Math.floor((untilStart % (24 * 3600 * 1000)) / (3600 * 1000))),
            })
          : t("tripHero.countdownTitle", { days: 0, hours: 0 });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 lg:px-8">
      <TripBackToTripsHubLink />
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className={cn(
          "relative isolate overflow-hidden rounded-3xl p-6 text-white shadow-[var(--shadow-pop)] sm:p-8",
          (!coverUrl || heroImageFailed) && heroGradient,
          coverUrl && !heroImageFailed && "min-h-[280px] sm:min-h-[320px]"
        )}
      >
        {coverUrl && !heroImageFailed ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- hero via Wikimedia proxy or direct URL */}
            <img
              src={imgShownSrc}
              alt=""
              loading="eager"
              decoding="async"
              fetchPriority="high"
              referrerPolicy="no-referrer"
              onError={() => {
                if (coverUrl && imgShownSrc !== coverUrl) {
                  setImgShownSrc(coverUrl);
                  return;
                }
                setHeroImageFailed(true);
              }}
              className="pointer-events-none absolute inset-0 z-0 size-full min-h-full min-w-full object-cover object-center"
            />
            <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black/68 via-black/38 to-black/22" />
          </>
        ) : (
          <div className="pointer-events-none absolute inset-0 z-0 opacity-25 [background-image:radial-gradient(at_20%_-10%,rgba(255,255,255,0.55)_0%,transparent_45%),radial-gradient(at_80%_120%,rgba(255,255,255,0.4)_0%,transparent_50%)]" />
        )}
        <div className="relative z-[2]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <Badge tone="outline" className="border-white/40 bg-white/15 text-white">
              {heroLabel}
            </Badge>
            {canManage && trip.destinations.length > 0 ? (
              <IconButton
                label={t("tripHero.refreshHero")}
                variant="ghost"
                size="sm"
                className="shrink-0 text-white hover:bg-white/15"
                disabled={heroBusy}
                onClick={() => void refreshHeroCover()}
              >
                {heroBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </IconButton>
            ) : null}
          </div>
          {heroCoverError ? (
            <p className="mt-2 max-w-xl text-xs text-white/80">{heroCoverError}</p>
          ) : coverUrl && heroImageFailed ? (
            <p className="mt-2 max-w-xl text-xs text-amber-100/95">{t("tripHero.heroImageLoadFailed")}</p>
          ) : null}
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
            {trip.title}
          </h1>
          <p className="mt-1 text-sm text-white/85">
            {t("tripHero.dates", {
              start: new Date(trip.startDate).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              }),
              end: new Date(trip.endDate).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              }),
            })}
          </p>
          {trip.description ? (
            <p className="mt-3 max-w-2xl text-sm text-white/85">{trip.description}</p>
          ) : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <HeroStat
              label={
                phase === "before_start"
                  ? t("dashboard.upcoming")
                  : phase === "during"
                    ? t("dashboard.inProgressLabel")
                    : t("dashboard.endedLabel")
              }
              value={
                untilStart != null && untilStart > 0
                  ? formatDurationMs(untilStart, t)
                  : totalMs != null
                    ? formatDurationMs(totalMs, t)
                    : "—"
              }
            />
            <HeroStat
              label={t("dashboard.placesLabel", { count: trip.destinations.length })}
              value={String(trip.destinations.length)}
            />
            <HeroStat
              label={t("dashboard.stepsLabel", { count: trip.steps.length })}
              value={String(trip.steps.length)}
            />
            <HeroStat
              label={t("dashboard.collaboratorsLabel")}
              value={String(collaborators.length)}
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary" className="gap-1.5">
              <Link href={`/trip/${trip.id}/itinerary`}>
                <CalendarRange className="h-4 w-4" /> {t("tripHero.openItinerary")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary" className="gap-1.5">
              <Link href={`/trip/${trip.id}/map`}>
                <MapIcon className="h-4 w-4" /> {t("tripHero.openMap")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary" className="gap-1.5">
              <Link href={`/trip/${trip.id}/budget`}>
                <Wallet className="h-4 w-4" /> {t("tripHero.openBudget")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary" className="gap-1.5">
              <Link href={`/trip/${trip.id}/packing`}>
                <ListChecks className="h-4 w-4" /> {t("tripHero.openPacking")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary" className="gap-1.5">
              <Link href={`/trip/${trip.id}/collab`}>
                <MessagesSquare className="h-4 w-4" /> {t("tripHero.openCollab")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="gap-1.5 text-white hover:bg-white/15">
              <Link href={`/trip/${trip.id}/manage`}>
                <Settings2 className="h-4 w-4" /> {t("shell.manage")}
              </Link>
            </Button>
          </div>
          {trip.heroCover?.photoPageUrl ? (
            <p className="mt-4 text-[10px] leading-relaxed text-white/70">
              <a
                href={trip.heroCover.photoPageUrl}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-white/40 underline-offset-2 hover:text-white"
              >
                {trip.heroCover.photographerName
                  ? t("tripHero.photoCredit", { name: trip.heroCover.photographerName })
                  : t("tripHero.photoCreditFallback")}
              </a>
              {trip.heroCover.licenseNote ? ` · ${trip.heroCover.licenseNote}` : null}
            </p>
          ) : trip.heroCover?.photographerName ? (
            <p className="mt-4 text-[10px] text-white/70">
              {t("tripHero.photoCredit", { name: trip.heroCover.photographerName })}
              {trip.heroCover.licenseNote ? ` · ${trip.heroCover.licenseNote}` : null}
            </p>
          ) : null}
        </div>
      </motion.section>

      <InlineAgentSuggestions trip={trip} />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="min-w-0 overflow-visible">
          <CardHeader className="overflow-visible">
            <CardTitle className="flex w-full min-w-0 items-center gap-2">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <CloudSun className="h-4 w-4 shrink-0 text-[var(--color-accent-sky)]" />
                <span className="truncate">{t("dashboard.quickItinerary")}</span>
              </span>
              {showFullHistoricalCaption || showMixedCaption ? (
                <WeatherDisclaimerHint
                  label={t("dashboard.weatherDisclaimerLabel")}
                  text={
                    showMixedCaption
                      ? t("dashboard.weatherTripMixedCaption", { year: String(proxyYear) })
                      : t("dashboard.weatherTripHistoricalCaption", { year: String(proxyYear) })
                  }
                />
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="min-w-0">
            {!weatherCentroid ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">{t("dashboard.weatherUnavailable")}</p>
            ) : weather.loading ? (
              <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-[4.75rem] shrink-0 rounded-2xl sm:w-20" />
                ))}
              </div>
            ) : tripWeatherRows.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">{t("dashboard.weatherUnavailable")}</p>
            ) : (
              <div className="space-y-2">
                {weather.error ? (
                  <p className="text-[11px] text-[var(--color-danger)]">{weather.error}</p>
                ) : null}
                <TripWeatherMarquee rows={tripWeatherRows} />
                {weather.seasonalOutlook ? (
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-[11px] leading-relaxed text-[var(--color-muted-foreground)]">
                    <p className="font-semibold text-[var(--color-foreground)]">
                      {t("dashboard.seasonalOutlookTitle")}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{weather.seasonalOutlook}</p>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--color-brand)]" /> {t("dashboard.collaboratorsLabel")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {collaborators.length === 0 ? (
              <EmptyState
                title={t("collab.presenceEmpty")}
                description={t("collab.subheading")}
                className="py-6"
              />
            ) : (
              <ul className="space-y-2">
                {collaborators.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>{avatarInitials(p.name)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium text-[var(--color-foreground)]">{p.name}</p>
                        {p.email ? (
                          <p className="text-[11px] text-[var(--color-muted-foreground)]">{p.email}</p>
                        ) : null}
                      </div>
                    </div>
                    {trip.travelers.find((tr) => tr.id === p.id) ? (
                      <Badge tone="brand">{t("manage.travelers")}</Badge>
                    ) : (
                      <Badge tone="neutral">{t("manage.viewers")}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Tap `!` to show (viewport-centered); tap again to dismiss; auto-hides after 3s while open. */
function WeatherDisclaimerHint({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [panelTop, setPanelTop] = useState<number | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    closeTimerRef.current = null;
    fadeTimerRef.current = null;
  };

  const beginFadeOut = () => {
    setExiting(true);
    fadeTimerRef.current = setTimeout(() => {
      setOpen(false);
      setExiting(false);
      fadeTimerRef.current = null;
    }, 300);
  };

  const scheduleAutoClose = () => {
    clearTimers();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      beginFadeOut();
    }, 3000);
  };

  useEffect(() => () => clearTimers(), []);

  useLayoutEffect(() => {
    if (!open) {
      setPanelTop(null);
      return;
    }
    const el = anchorRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setPanelTop(r.bottom + 8);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  function onIconActivate() {
    if (!open) {
      setExiting(false);
      setOpen(true);
      scheduleAutoClose();
      return;
    }
    clearTimers();
    setExiting(false);
    setOpen(false);
  }

  return (
    <>
      <div ref={anchorRef} className="shrink-0">
        <IconButton
          label={label}
          size="sm"
          variant="outline"
          aria-expanded={open}
          className="size-7 shrink-0 rounded-full border-[var(--color-border)] p-0 text-[12px] font-bold leading-none text-[var(--color-muted-foreground)]"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onIconActivate();
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
        >
          !
        </IconButton>
      </div>
      {open && panelTop !== null ? (
        <div
          role="status"
          style={{ top: panelTop }}
          className={cn(
            "fixed left-1/2 z-[60] w-[min(28rem,calc(100vw-1.25rem))] max-w-[calc(100vw-1.25rem)] -translate-x-1/2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-left text-xs leading-snug text-[var(--color-foreground)] shadow-[var(--shadow-pop)] transition-opacity duration-300 ease-out sm:px-4 sm:py-3 sm:text-[13px] sm:leading-relaxed",
            exiting ? "opacity-0" : "opacity-100"
          )}
        >
          {text}
        </div>
      ) : null}
    </>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/15 p-3 backdrop-blur">
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function TripWeatherMarquee({ rows }: { rows: TripWeatherRow[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }),
    []
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    horizontal: true,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    gap: 8,
    overscan: 6,
    enabled: rows.length > 0,
  });

  if (rows.length === 0) return null;

  return (
    <div
      ref={parentRef}
      className="relative min-h-[5.75rem] min-w-0 overflow-x-auto overflow-y-hidden pb-1 [-webkit-overflow-scrolling:touch]"
      style={{ touchAction: "pan-x" }}
      role="list"
    >
      <div
        className="relative isolate"
        style={{
          width: virtualizer.getTotalSize(),
          height: "5.75rem",
        }}
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const d = rows[vi.index];
          const has = d.source !== "none" && Number.isFinite(d.tempMaxC) && Number.isFinite(d.tempMinC);
          return (
            <div
              key={vi.key}
              role="listitem"
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 flex h-full items-stretch py-0.5"
              style={{ transform: `translateX(${vi.start}px)` }}
            >
              <div className="flex min-w-[4.75rem] shrink-0 flex-col items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-2 text-center text-xs sm:min-w-20">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  {fmt.format(new Date(`${d.dateIso}T12:00:00.000Z`))}
                </span>
                <span aria-hidden className="text-2xl leading-none">
                  {weatherCodeIcon(has ? d.weatherCode : undefined)}
                </span>
                <span className="font-semibold text-[var(--color-foreground)]">
                  {has ? `${Math.round(d.tempMaxC)}° / ${Math.round(d.tempMinC)}°` : "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
