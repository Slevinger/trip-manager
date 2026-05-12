"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarRange,
  LayoutDashboard,
  ListChecks,
  Map as MapIcon,
  Settings2,
  User as UserIcon,
  Wallet,
} from "lucide-react";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/messages";
import { cn } from "@/lib/ui/cn";

interface BottomTab {
  href: (tripId: string | null) => string;
  match: (pathname: string, tripId: string | null) => boolean;
  labelKey: MessageKey;
  Icon: typeof LayoutDashboard;
}

const HOME_TAB: BottomTab = {
  href: () => "/",
  match: (p) => p === "/" || p === "" || (p.startsWith("/") && !p.startsWith("/trip") && !p.startsWith("/profile")),
  labelKey: "shell.dashboard",
  Icon: LayoutDashboard,
};

/** When viewing a trip, bottom bar is in-trip screens only (no global home). */
const TRIP_BOTTOM_TABS: BottomTab[] = [
  {
    href: (id) => (id ? `/trip/${id}/itinerary` : "/"),
    match: (p, id) => Boolean(id) && p.startsWith(`/trip/${id}/itinerary`),
    labelKey: "shell.itinerary",
    Icon: CalendarRange,
  },
  {
    href: (id) => (id ? `/trip/${id}/map` : "/"),
    match: (p, id) => Boolean(id) && p.startsWith(`/trip/${id}/map`),
    labelKey: "shell.map",
    Icon: MapIcon,
  },
  {
    href: (id) => (id ? `/trip/${id}/budget` : "/"),
    match: (p, id) => Boolean(id) && p.startsWith(`/trip/${id}/budget`),
    labelKey: "shell.budget",
    Icon: Wallet,
  },
  {
    href: (id) => (id ? `/trip/${id}/packing` : "/profile"),
    match: (p, id) =>
      Boolean(id) ? p.startsWith(`/trip/${id}/packing`) : p.startsWith("/profile"),
    labelKey: "shell.packing",
    Icon: ListChecks,
  },
  {
    href: (id) => (id ? `/trip/${id}/manage` : "/"),
    match: (p, id) => Boolean(id) && p.startsWith(`/trip/${id}/manage`),
    labelKey: "shell.manage",
    Icon: Settings2,
  },
];

const PROFILE_TAB: BottomTab = {
  href: () => "/profile",
  match: (p) => p.startsWith("/profile"),
  labelKey: "shell.profile",
  Icon: UserIcon,
};

export function BottomTabs({ tripId }: { tripId: string | null }) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "/";

  const tabs = tripId ? TRIP_BOTTOM_TABS : [HOME_TAB, PROFILE_TAB];

  return (
    <nav
      aria-label={t("shell.menu")}
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--color-border)] bg-[var(--color-surface)]/85 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 shadow-[0_-8px_24px_-12px_rgb(15_23_42/0.15)] backdrop-blur lg:hidden"
    >
      <ul className={cn("grid gap-0.5 px-1", tripId ? "grid-cols-5" : "grid-cols-2")}>
        {tabs.map(({ href, match, labelKey, Icon }) => {
          const active = match(pathname, tripId);
          return (
            <li key={labelKey} className="relative">
              <Link
                href={href(tripId)}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5 text-[9px] font-semibold leading-tight transition-colors sm:px-1.5 sm:text-[10px]",
                  active
                    ? "text-[var(--color-brand)]"
                    : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="bottom-active"
                    transition={{ type: "spring", duration: 0.35, bounce: 0.25 }}
                    className="absolute inset-0 -z-10 rounded-2xl bg-[var(--color-brand-soft)]"
                  />
                ) : null}
                <Icon className="h-5 w-5" />
                <span>{t(labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
