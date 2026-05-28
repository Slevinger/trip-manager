"use client";

import Link from "next/link";
import { Compass, Lock, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { signInWithGoogle } from "@/lib/googleSignIn";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { TripLoadState } from "@/lib/trip/useTripData";

/** Renders the standard "missing / needs auth / etc." state for any trip-scoped screen. */
export function TripLoadStateScreen({ state }: { state: TripLoadState }) {
  const { t } = useI18n();

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 lg:px-8">
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (state === "needs_auth") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 lg:px-8">
        <EmptyState
          icon={<Compass className="h-7 w-7" />}
          title={t("trip.signInRequired")}
          description={t("trip.signInRequiredBody")}
          action={
            <Button onClick={() => void signInWithGoogle()}>{t("common.signInWithGoogle")}</Button>
          }
        />
      </div>
    );
  }

  if (state === "needs_google") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 lg:px-8">
        <EmptyState
          icon={<Compass className="h-7 w-7" />}
          title={t("trip.googleRequired")}
          description={t("trip.googleRequiredBody")}
          action={
            <Button onClick={() => void signInWithGoogle()}>{t("common.signInWithGoogle")}</Button>
          }
        />
      </div>
    );
  }

  if (state === "access_denied") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 lg:px-8">
        <EmptyState
          icon={<Lock className="h-7 w-7" />}
          title={t("trip.accessDenied")}
          description={t("trip.accessDeniedBody")}
          action={
            <Button asChild variant="secondary">
              <Link href="/">{t("trip.backToTrips")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 lg:px-8">
      <EmptyState
        icon={<Search className="h-7 w-7" />}
        title={t("trip.notFound")}
        description={t("trip.notFoundBody")}
        action={
          <Button asChild variant="secondary">
            <Link href="/">{t("trip.backToTrips")}</Link>
          </Button>
        }
      />
    </div>
  );
}
