"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  CalendarRange,
  ListChecks,
  Map as MapIcon,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { Avatar, AvatarFallback, AvatarImage, avatarInitials } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/ui/cn";
import {
  getTripViewPhase,
  msUntilTripStart,
  tripInstantMs,
} from "@/lib/tripViewPhase";
import { useTripWeather, weatherCodeIcon } from "@/lib/weather/useTripWeather";
import type { Trip, Traveler, TripViewer } from "@/lib/types/trip";

const HOUR_MS = 3600 * 1000;

function formatRange(startIso: string, endIso: string): string {
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const yearFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  const a = tripInstantMs(startIso);
  const b = tripInstantMs(endIso);
  if (a == null || b == null) return "—";
  const aDate = new Date(a);
  const bDate = new Date(b);
  if (aDate.getFullYear() !== bDate.getFullYear()) {
    return `${yearFmt.format(aDate)} → ${yearFmt.format(bDate)}`;
  }
  return `${fmt.format(aDate)} → ${yearFmt.format(bDate)}`;
}

export function TripCard({ trip }: { trip: Trip }) {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const nowMs = Date.now();
  const phase = getTripViewPhase(trip, nowMs);
  const untilStart = msUntilTripStart(trip, nowMs);
  const weather = useTripWeather(trip);

  const collaborators: Array<Traveler | TripViewer> = [
    ...trip.travelers,
    ...(trip.viewers ?? []),
  ];

  const gradient =
    phase === "during"
      ? "bg-gradient-meadow"
      : phase === "after_end"
        ? "bg-gradient-aurora"
        : "bg-gradient-brand";

  const countdownLabel =
    phase === "during"
      ? t("dashboard.inProgressLabel")
      : phase === "after_end"
        ? t("dashboard.endedLabel")
        : untilStart != null
          ? untilStart < HOUR_MS
            ? t("dashboard.countdownStartingNow")
            : untilStart < 48 * HOUR_MS
              ? t("dashboard.countdownHours", { count: Math.max(1, Math.round(untilStart / HOUR_MS)) })
              : t("dashboard.countdownDays", { count: Math.max(1, Math.round(untilStart / (24 * HOUR_MS))) })
          : t("dashboard.countdownStartingNow");

  return (
    <motion.article
      whileHover={reduce ? undefined : { y: -4 }}
      transition={{ type: "spring", stiffness: 250, damping: 20 }}
      className="group relative overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)] transition-shadow hover:shadow-[var(--shadow-pop)]"
    >
      <Link
        href={`/trip/${trip.id}`}
        className={cn("block px-5 pb-4 pt-5 text-white", gradient)}
      >
        <div className="flex items-center justify-between gap-2">
          <Badge tone="outline" className="border-white/40 bg-white/15 text-white">
            {countdownLabel}
          </Badge>
          {weather.daily && weather.daily[0] ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">
              <span aria-hidden>{weatherCodeIcon(weather.daily[0].weatherCode)}</span>
              {Math.round(weather.daily[0].tempMaxC)}°
            </span>
          ) : weather.loading ? (
            <Skeleton className="h-6 w-12 rounded-full bg-white/20" />
          ) : null}
        </div>
        <h3 className="mt-3 line-clamp-1 text-2xl font-semibold tracking-tight">{trip.title}</h3>
        <p className="mt-1 text-xs text-white/85">{formatRange(trip.startDate, trip.endDate)}</p>
        {trip.description ? (
          <p className="mt-2 line-clamp-2 text-sm text-white/80">{trip.description}</p>
        ) : null}
      </Link>

      <div className="px-5 py-4">
        <div className="flex items-center gap-2 text-[11px] font-medium text-[var(--color-muted-foreground)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand)]" />
          {t("dashboard.placesLabel", { count: trip.destinations.length })} ·{" "}
          {t("dashboard.stepsLabel", { count: trip.steps.length })}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <QuickAction href={`/trip/${trip.id}/itinerary`} icon={<CalendarRange className="h-3.5 w-3.5" />} label={t("dashboard.quickItinerary")} />
          <QuickAction href={`/trip/${trip.id}/map`} icon={<MapIcon className="h-3.5 w-3.5" />} label={t("dashboard.quickMap")} />
          <QuickAction href={`/trip/${trip.id}/budget`} icon={<Wallet className="h-3.5 w-3.5" />} label={t("dashboard.quickBudget")} />
          <QuickAction href={`/trip/${trip.id}/packing`} icon={<ListChecks className="h-3.5 w-3.5" />} label={t("dashboard.quickPacking")} />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center -space-x-2">
            {collaborators.slice(0, 4).map((p) => (
              <Avatar key={p.id} className="h-7 w-7 border-2 border-[var(--color-surface)]">
                <AvatarFallback className="text-[10px]">{avatarInitials(p.name)}</AvatarFallback>
              </Avatar>
            ))}
            {collaborators.length > 4 ? (
              <span className="ml-2 text-[10px] font-medium text-[var(--color-muted-foreground)]">
                +{collaborators.length - 4}
              </span>
            ) : null}
          </div>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/trip/${trip.id}`}>{t("dashboard.openTrip")}</Link>
          </Button>
        </div>
      </div>
    </motion.article>
  );
}

function QuickAction({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-foreground)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
    >
      <span className="text-[var(--color-brand)]">{icon}</span>
      {label}
    </Link>
  );
}
