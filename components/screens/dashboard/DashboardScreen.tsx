"use client";

import { useMemo, useState } from "react";
import { logCaughtException } from "@/lib/logCaughtException";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Compass, Plus, Sparkles } from "lucide-react";
import { useFirebaseUser } from "@/lib/auth/useFirebaseUser";
import { useI18n } from "@/lib/i18n/context";
import { useMyTrips } from "@/lib/trip/useMyTrips";
import { signInWithGoogle } from "@/lib/googleSignIn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty";
import { TripCard } from "./TripCard";
import { getTripViewPhase } from "@/lib/tripViewPhase";
import type { Trip } from "@/lib/types/trip";

const CreateTripWizard = dynamic(
  () => import("@/components/CreateTripWizard").then((m) => ({ default: m.CreateTripWizard })),
  { ssr: false }
);

type Bucket = "in_progress" | "upcoming" | "past";

function bucketTrip(trip: Trip): Bucket {
  const phase = getTripViewPhase(trip, Date.now());
  if (phase === "during") return "in_progress";
  if (phase === "before_start") return "upcoming";
  return "past";
}

export function DashboardScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useFirebaseUser();
  const { trips, loading, error, needsSignIn, saveTrip, deleteTrip } = useMyTrips();
  const [wizardOpen, setWizardOpen] = useState(false);

  const buckets = useMemo(() => {
    const map: Record<Bucket, Trip[]> = { in_progress: [], upcoming: [], past: [] };
    for (const trip of trips) map[bucketTrip(trip)].push(trip);
    map.upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
    map.past.sort((a, b) => b.endDate.localeCompare(a.endDate));
    return map;
  }, [trips]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-brand)]">
            <Sparkles className="h-3.5 w-3.5" /> Wander
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--color-foreground)] sm:text-4xl">
            {user?.displayName?.trim()
              ? `${t("dashboard.heading")} · ${user.displayName.split(" ")[0]}`
              : t("dashboard.heading")}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            {t("dashboard.subheading")}
          </p>
        </div>
        <Button size="lg" onClick={() => setWizardOpen(true)} disabled={needsSignIn} className="gap-2">
          <Plus className="h-4 w-4" /> {t("dashboard.newTrip")}
        </Button>
      </header>

      {error ? (
        <p className="rounded-2xl border border-[var(--color-danger)]/40 bg-[color-mix(in_oklab,var(--color-danger)_12%,transparent)] px-4 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {needsSignIn ? (
        <EmptyState
          icon={<Compass className="h-7 w-7" />}
          title={t("dashboard.signedOutTitle")}
          description={t("dashboard.signedOutBody")}
          action={
            <Button onClick={() => void signInWithGoogle()}>{t("common.signInWithGoogle")}</Button>
          }
        />
      ) : loading ? (
        <Loading />
      ) : trips.length === 0 ? (
        <EmptyState
          icon={<Compass className="h-7 w-7" />}
          title={t("dashboard.emptyTitle")}
          description={t("dashboard.emptyBody")}
          action={
            <Button onClick={() => setWizardOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> {t("dashboard.newTrip")}
            </Button>
          }
        />
      ) : (
        <div className="space-y-10">
          <Section title={t("dashboard.inProgress")} trips={buckets.in_progress} onDelete={deleteTrip} />
          <Section title={t("dashboard.upcoming")} trips={buckets.upcoming} onDelete={deleteTrip} />
          <Section title={t("dashboard.past")} trips={buckets.past} muted onDelete={deleteTrip} />
        </div>
      )}

      <CreateTripWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreate={async (trip) => {
          try {
            await saveTrip(trip);
            setWizardOpen(false);
            router.push(`/trip/${trip.id}`);
          } catch (e) {
            logCaughtException(e, "DashboardScreen/wizardOnCreate/saveTrip");
          }
        }}
      />
    </div>
  );
}

function Section({
  title,
  trips,
  muted,
  onDelete,
}: {
  title: string;
  trips: Trip[];
  muted?: boolean;
  onDelete?: (trip: Trip) => Promise<void>;
}) {
  if (trips.length === 0) return null;
  return (
    <section>
      <h2
        className={
          "mb-3 text-xs font-semibold uppercase tracking-[0.18em] " +
          (muted ? "text-[var(--color-muted-foreground)]" : "text-[var(--color-foreground)]")
        }
      >
        {title}
      </h2>
      <motion.div
        layout
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {trips.map((trip) => (
          <TripCard key={trip.id} trip={trip} onDelete={onDelete} />
        ))}
      </motion.div>
    </section>
  );
}

function Loading() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-72 w-full" />
      ))}
    </div>
  );
}
