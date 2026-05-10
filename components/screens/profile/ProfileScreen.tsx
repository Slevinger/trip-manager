"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Award,
  Compass,
  Globe,
  MapPin,
  Sparkles,
  Trophy,
  Wand2,
} from "lucide-react";
import { useFirebaseUser } from "@/lib/auth/useFirebaseUser";
import { useI18n } from "@/lib/i18n/context";
import { useMyTrips } from "@/lib/trip/useMyTrips";
import { computeTravelStats, deriveAchievements } from "@/lib/profile/achievements";
import { Avatar, AvatarFallback, AvatarImage, avatarInitials } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { signInWithGoogle } from "@/lib/googleSignIn";

export function ProfileScreen() {
  const { t } = useI18n();
  const { user } = useFirebaseUser();
  const { trips, loading, needsSignIn } = useMyTrips();
  const stats = useMemo(() => computeTravelStats(trips), [trips]);
  const achievements = useMemo(() => deriveAchievements(stats), [stats]);

  const [insights, setInsights] = useState<{ loading: boolean; text: string | null; error: string | null }>({
    loading: false,
    text: null,
    error: null,
  });

  useEffect(() => {
    if (!user || trips.length === 0) return;
    let cancelled = false;
    setInsights({ loading: true, text: null, error: null });
    void (async () => {
      try {
        const sample = trips[0];
        const res = await fetch("/api/chat/trip-assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trip: sample,
            messages: [
              {
                role: "user",
                content: `Based on the user's travel stats — ${stats.trips} trips, ${stats.daysTraveled} days, ${stats.countries.length} countries, ${(stats.distanceMeters / 1000).toFixed(0)} km — and their typical interests, give a single 2-sentence personal insight (no lists, no markdown).`,
              },
            ],
          }),
        });
        if (cancelled) return;
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json().catch(() => ({}))) as { reply?: string };
        setInsights({ loading: false, text: (json.reply ?? "").trim(), error: null });
      } catch (err) {
        if (cancelled) return;
        setInsights({ loading: false, text: null, error: err instanceof Error ? err.message : "" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, trips, stats.trips, stats.daysTraveled, stats.countries.length, stats.distanceMeters]);

  if (needsSignIn) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 lg:px-8">
        <EmptyState
          icon={<Compass className="h-7 w-7" />}
          title={t("dashboard.signedOutTitle")}
          description={t("dashboard.signedOutBody")}
          action={
            <Button onClick={() => void signInWithGoogle()}>{t("common.signInWithGoogle")}</Button>
          }
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 lg:px-8">
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 lg:px-8">
      <header className="flex items-end gap-4">
        <Avatar className="h-16 w-16">
          {user?.photoURL ? <AvatarImage src={user.photoURL} alt={user.displayName ?? ""} /> : null}
          <AvatarFallback className="text-base">
            {avatarInitials(user?.displayName ?? user?.email ?? "")}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-brand)]">
            <Sparkles className="h-3.5 w-3.5" /> {t("stats.heading")}
          </p>
          <h1 className="mt-1 truncate text-3xl font-semibold tracking-tight">
            {user?.displayName?.trim() || user?.email || "Traveler"}
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("stats.subheading")}</p>
        </div>
      </header>

      {trips.length === 0 ? (
        <EmptyState
          icon={<Compass className="h-7 w-7" />}
          title={t("stats.empty")}
          description={t("dashboard.emptyBody")}
          action={
            <Button asChild>
              <a href="/">{t("dashboard.newTrip")}</a>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<Compass className="h-4 w-4" />}
              label={t("stats.tripsCount")}
              value={String(stats.trips)}
              tone="brand"
            />
            <StatCard
              icon={<Sparkles className="h-4 w-4" />}
              label={t("stats.daysTraveled")}
              value={String(stats.daysTraveled)}
              tone="coral"
            />
            <StatCard
              icon={<Globe className="h-4 w-4" />}
              label={t("stats.countriesVisited")}
              value={String(stats.countries.length)}
              tone="mint"
              detail={stats.countries.slice(0, 6).join(" · ")}
            />
            <StatCard
              icon={<MapPin className="h-4 w-4" />}
              label={t("stats.distanceTraveled")}
              value={`${(stats.distanceMeters / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`}
              tone="sky"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-[var(--color-accent-amber)]" /> {t("stats.achievements")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {achievements.every((a) => !a.unlocked) ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">{t("stats.achievementsEmpty")}</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {achievements.map((a) => (
                      <li
                        key={a.id}
                        className={
                          "flex items-center gap-3 rounded-2xl border border-[var(--color-border)] p-3 " +
                          (a.unlocked
                            ? "bg-[var(--color-surface)]"
                            : "bg-[var(--color-surface-muted)]/40 opacity-70")
                        }
                      >
                        <span aria-hidden className="text-2xl">
                          {a.emoji}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[var(--color-foreground)]">{a.title}</p>
                          <p className="text-[11px] text-[var(--color-muted-foreground)]">{a.description}</p>
                        </div>
                        {a.unlocked ? <Badge tone="success">unlocked</Badge> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-[var(--color-brand)]" /> {t("stats.insightsTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {insights.loading ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">{t("stats.insightsLoading")}</p>
                ) : insights.text ? (
                  <p className="text-sm text-[var(--color-foreground)]">{insights.text}</p>
                ) : insights.error ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">{t("stats.insightsError")}</p>
                ) : (
                  <p className="text-sm text-[var(--color-muted-foreground)]">{t("stats.insightsAsk")}</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-4 w-4 text-[var(--color-accent-mint)]" /> {t("stats.recentTrips")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-[var(--color-border)]">
                {trips
                  .slice()
                  .sort((a, b) => b.startDate.localeCompare(a.startDate))
                  .slice(0, 6)
                  .map((trip) => (
                    <li key={trip.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--color-foreground)]">{trip.title}</p>
                        <p className="text-[11px] text-[var(--color-muted-foreground)]">
                          {new Date(trip.startDate).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}{" "}
                          → {new Date(trip.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </p>
                      </div>
                      <Badge tone="neutral">
                        {trip.destinations.length} {t("dashboard.placesLabel", { count: trip.destinations.length }).split(" ")[1] ?? "places"}
                      </Badge>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "brand" | "coral" | "mint" | "sky";
  detail?: string;
}) {
  const gradient =
    tone === "brand"
      ? "bg-gradient-brand"
      : tone === "coral"
        ? "bg-gradient-sunset"
        : tone === "mint"
          ? "bg-gradient-meadow"
          : "bg-gradient-aurora";
  return (
    <Card className="overflow-hidden">
      <div className={`flex items-center justify-between px-4 py-3 text-white ${gradient}`}>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        </div>
        <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-white/20">{icon}</span>
      </div>
      {detail ? <p className="px-4 py-2 text-[11px] text-[var(--color-muted-foreground)]">{detail}</p> : null}
    </Card>
  );
}
