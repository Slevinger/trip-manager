"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  ListChecks,
  Map as MapIcon,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { formatTripHeroDateRangeLine } from "@/lib/i18n/formatTripHeroDateRange";
import { Avatar, AvatarFallback, AvatarImage, avatarInitials } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/ui/cn";
import { getTripViewPhase, msUntilTripStart } from "@/lib/tripViewPhase";
import { heroCoverImageSrc } from "@/lib/trip/heroCoverDisplayUrl";
import { useTripWeather, weatherCodeIcon } from "@/lib/weather/useTripWeather";
import type { Trip, Traveler, TripViewer } from "@/lib/types/trip";

const HOUR_MS = 3600 * 1000;

export function TripCard({ trip }: { trip: Trip }) {
  const { t, locale } = useI18n();
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

  const coverUrl = trip.heroCover?.url?.trim();
  const proxiedCoverSrc = coverUrl ? heroCoverImageSrc(coverUrl) : "";
  const [cardImgSrc, setCardImgSrc] = useState(() => proxiedCoverSrc || coverUrl || "");
  const [cardImageFailed, setCardImageFailed] = useState(false);

  useEffect(() => {
    setCardImgSrc(proxiedCoverSrc || coverUrl || "");
    setCardImageFailed(false);
  }, [coverUrl, proxiedCoverSrc]);

  const heroDateLine = useMemo(
    () => formatTripHeroDateRangeLine(trip.startDate, trip.endDate, locale, t),
    [trip.startDate, trip.endDate, locale, t]
  );

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
        className={cn(
          "relative isolate block overflow-hidden px-5 pb-4 pt-5 text-white",
          (!coverUrl || cardImageFailed) && gradient,
          coverUrl && !cardImageFailed && "min-h-[148px]"
        )}
      >
        {coverUrl && !cardImageFailed ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- same remote hero as trip overview */}
            <img
              src={cardImgSrc}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => {
                if (coverUrl && cardImgSrc !== coverUrl) {
                  setCardImgSrc(coverUrl);
                  return;
                }
                setCardImageFailed(true);
              }}
              className="pointer-events-none absolute inset-0 z-0 size-full min-h-full min-w-full object-cover object-center"
            />
            <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black/60 via-black/35 to-black/20" />
          </>
        ) : (
          <div className="pointer-events-none absolute inset-0 z-0 opacity-25 [background-image:radial-gradient(at_20%_-10%,rgba(255,255,255,0.55)_0%,transparent_45%),radial-gradient(at_80%_120%,rgba(255,255,255,0.4)_0%,transparent_50%)]" />
        )}
        <div className="relative z-[2]">
          <div className="flex items-center justify-between gap-2">
            <Badge tone="outline" className="border-white/40 bg-white/15 text-white">
              {countdownLabel}
            </Badge>
            {(() => {
              const day0 = trip.startDate.slice(0, 10);
              const w0 =
                weather.daily?.find((d) => d.dateIso.slice(0, 10) === day0) ??
                weather.tripHistorical?.daily.find((d) => d.dateIso.slice(0, 10) === day0);
              if (w0 && Number.isFinite(w0.tempMaxC)) {
                return (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold"
                    title={
                      weather.weatherRange?.mode === "nearby_preview"
                        ? t("dashboard.weatherNearbyPreview")
                        : undefined
                    }
                  >
                    <span aria-hidden>{weatherCodeIcon(w0.weatherCode)}</span>
                    {Math.round(w0.tempMaxC)}°
                  </span>
                );
              }
              return weather.loading ? (
                <Skeleton className="h-6 w-12 rounded-full bg-white/20" />
              ) : null;
            })()}
          </div>
          <h3 className="mt-3 line-clamp-1 text-2xl font-semibold tracking-tight">{trip.title}</h3>
          <p className="mt-1 text-xs text-white/85">{heroDateLine}</p>
          {trip.description ? (
            <p className="mt-2 line-clamp-2 text-sm text-white/80">{trip.description}</p>
          ) : null}
        </div>
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
