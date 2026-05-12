"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";

const pill =
  "inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium text-[var(--color-muted-foreground)] shadow-sm transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-foreground)]";

/** `/trip/[id]/…` sub-routes → trip overview hub */
export function TripBackToTripLink({ tripId }: { tripId: string }) {
  const { t, locale } = useI18n();
  const rtl = locale === "he";
  return (
    <Link href={`/trip/${tripId}`} className={cn(pill, rtl && "flex-row-reverse")}>
      <ArrowLeft className={cn("h-3.5 w-3.5 shrink-0", rtl && "rotate-180")} aria-hidden />
      <span>{t("shell.backToTrip")}</span>
    </Link>
  );
}

/** Trip overview & profile → dashboard trip list */
export function TripBackToTripsHubLink({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const rtl = locale === "he";
  return (
    <Link href="/" className={cn(pill, rtl && "flex-row-reverse", className)}>
      <ArrowLeft className={cn("h-3.5 w-3.5 shrink-0", rtl && "rotate-180")} aria-hidden />
      <span>{t("shell.allTrips")}</span>
    </Link>
  );
}
