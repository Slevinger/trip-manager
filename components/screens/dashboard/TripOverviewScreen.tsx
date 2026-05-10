"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  CalendarRange,
  CloudSun,
  ListChecks,
  Map as MapIcon,
  MessagesSquare,
  Settings2,
  Users,
  Wallet,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useTripData } from "@/lib/trip/useTripData";
import { useTripWeather, weatherCodeIcon } from "@/lib/weather/useTripWeather";
import { Avatar, AvatarFallback, AvatarImage, avatarInitials } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { InlineAgentSuggestions } from "@/components/agent/InlineAgentSuggestions";
import { TripLoadStateScreen } from "@/components/screens/_shared/TripLoadStateScreen";
import {
  formatDurationMs,
  getTripViewPhase,
  msUntilTripStart,
  tripInstantMs,
  tripTotalDurationMs,
} from "@/lib/tripViewPhase";
import type { Traveler, Trip, TripViewer, WeatherDay } from "@/lib/types/trip";

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

export function TripOverviewScreen({ tripId }: { tripId: string }) {
  const { t } = useI18n();
  const { trip, loadState } = useTripData(tripId);

  if (loadState !== "ok" || !trip) {
    return <TripLoadStateScreen state={loadState} />;
  }

  return <TripOverviewContent trip={trip} />;
}

function TripOverviewContent({ trip }: { trip: Trip }) {
  const { t } = useI18n();
  const nowMs = Date.now();
  const phase = getTripViewPhase(trip, nowMs);
  const untilStart = msUntilTripStart(trip, nowMs);
  const totalMs = tripTotalDurationMs(trip);
  const weather = useTripWeather(trip);

  const collaborators: Array<Traveler | TripViewer> = [
    ...trip.travelers,
    ...(trip.viewers ?? []),
  ];

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
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className={`relative overflow-hidden rounded-3xl ${heroGradient} p-6 text-white shadow-[var(--shadow-pop)] sm:p-8`}
      >
        <div className="absolute inset-0 opacity-30 mix-blend-overlay [background-image:radial-gradient(at_20%_-10%,rgba(255,255,255,0.7)_0%,transparent_45%),radial-gradient(at_80%_120%,rgba(255,255,255,0.5)_0%,transparent_50%)]" />
        <div className="relative">
          <Badge tone="outline" className="border-white/40 bg-white/15 text-white">
            {heroLabel}
          </Badge>
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
        </div>
      </motion.section>

      <InlineAgentSuggestions trip={trip} />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CloudSun className="h-4 w-4 text-[var(--color-accent-sky)]" /> {t("dashboard.quickItinerary")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {weather.loading ? (
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-2xl" />
                ))}
              </div>
            ) : weather.daily && weather.daily.length > 0 ? (
              <WeatherStrip daily={weather.daily.slice(0, 7)} />
            ) : (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                {t("dashboard.weatherUnavailable")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
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

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/15 p-3 backdrop-blur">
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function WeatherStrip({ daily }: { daily: WeatherDay[] }) {
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {daily.map((d) => (
        <div
          key={d.dateIso}
          className="flex min-w-20 flex-col items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-2 text-center text-xs"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            {fmt.format(new Date(d.dateIso))}
          </span>
          <span aria-hidden className="text-2xl">
            {weatherCodeIcon(d.weatherCode)}
          </span>
          <span className="font-semibold text-[var(--color-foreground)]">
            {Math.round(d.tempMaxC)}° / {Math.round(d.tempMinC)}°
          </span>
        </div>
      ))}
    </div>
  );
}
