"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { useAppSelector } from "@/lib/store/hooks";
import { cn } from "@/lib/ui/cn";

export type TripTab = "overview" | "itinerary" | "people" | "manage";

export function TripTopNav({ tripId }: { tripId: string }) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "";
  const activeTab: TripTab = pathname.startsWith(`/trip/${tripId}/manage/itinerary`)
    ? "itinerary"
    : pathname.startsWith(`/trip/${tripId}/manage/people`)
    ? "people"
    : pathname.startsWith(`/trip/${tripId}/manage`)
    ? "manage"
    : "overview";

  const trip = useAppSelector((s) => s.trip.trip);

  const stepCount = trip?.steps?.length ?? 0;
  const peopleCount = (trip?.travelers?.length ?? 0) + (trip?.viewers?.length ?? 0);

  const tabs = [
    { id: "overview" as TripTab, label: t("manage.tabOverview"),   href: `/trip/${tripId}`,                        count: null },
    { id: "itinerary" as TripTab, label: t("manage.tabItinerary"), href: `/trip/${tripId}/manage/itinerary`,       count: stepCount > 0 ? stepCount : null },
    { id: "people" as TripTab,    label: t("manage.tabPeople"),    href: `/trip/${tripId}/manage/people`,          count: peopleCount > 0 ? peopleCount : null },
    { id: "manage" as TripTab,    label: t("manage.tabLogistics"), href: `/trip/${tripId}/manage`,                 count: null },
  ];

  return (
    <nav
      aria-label={t("manage.tabsLabel")}
      className="sticky top-14 z-20 w-full overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="mx-auto flex w-full max-w-6xl px-4 lg:px-8">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 -mb-px whitespace-nowrap px-4 py-2.5 text-sm transition-colors",
              activeTab === tab.id
                ? "border-b-[3px] border-[var(--color-brand)] text-[var(--color-brand)] font-semibold"
                : "border-b-2 border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:border-[var(--color-border)]"
            )}
          >
            {tab.label}
            {tab.count != null ? (
              <span className={cn(
                "min-w-[1.25rem] rounded-full px-1 text-center text-[11px] font-semibold tabular-nums leading-5",
                activeTab === tab.id
                  ? "bg-[var(--color-brand-soft)] text-[var(--color-brand)]"
                  : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
              )}>
                {tab.count}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** Thin server-passthrough used by the trip-level layout. Keeps the nav as a
 *  single persistent instance across all /trip/[id]/* routes. */
export function TripTopNavWrapper({ tripId }: { tripId: string }) {
  return <TripTopNav tripId={tripId} />;
}
