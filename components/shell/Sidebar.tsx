"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  LayoutDashboard,
  User as UserIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { TRIP_NAV } from "./navItems";

interface SidebarProps {
  tripId: string | null;
  tripTitle?: string | null;
}

export function Sidebar({ tripId, tripTitle }: SidebarProps) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "/";

  return (
    <aside className="hidden h-screen w-64 shrink-0 flex-col border-e border-[var(--color-border)] bg-[var(--color-surface)] lg:sticky lg:top-0 lg:flex">
      <div className="flex items-center gap-2 px-5 py-5">
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-brand text-white shadow-[var(--shadow-soft)]"
        >
          <Compass className="h-5 w-5" />
        </span>
        <span className="text-lg font-semibold tracking-tight">Wander</span>
      </div>

      <nav className="px-3">
        <PrimaryLink
          href="/"
          active={pathname === "/" || pathname === ""}
          icon={<LayoutDashboard className="h-4 w-4" />}
          label={t("shell.dashboard")}
        />
        <PrimaryLink
          href="/profile"
          active={pathname.startsWith("/profile")}
          icon={<UserIcon className="h-4 w-4" />}
          label={t("shell.profile")}
        />
      </nav>

      {tripId ? (
        <div className="mt-3 px-3">
          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            {tripTitle?.trim() || t("shell.allTrips")}
          </p>
          <nav className="space-y-1">
            {TRIP_NAV.map((item) => {
              const active = item.match(pathname, tripId);
              const Icon = item.icon;
              return (
                <Link
                  key={item.labelKey}
                  href={item.href(tripId)}
                  className={cn(
                    "group relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "text-[var(--color-foreground)]"
                      : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="sidebar-active"
                      transition={{ type: "spring", duration: 0.4, bounce: 0.2 }}
                      className="absolute inset-0 -z-0 rounded-xl bg-[var(--color-brand-soft)]"
                    />
                  ) : null}
                  <Icon
                    className={cn(
                      "relative z-10 h-4 w-4",
                      active ? "text-[var(--color-brand)]" : "text-current"
                    )}
                  />
                  <span className="relative z-10">{t(item.labelKey)}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}

      <div className="mt-auto p-4 text-[10px] text-[var(--color-muted-foreground)]">
        v2 · {new Date().getFullYear()}
      </div>
    </aside>
  );
}

function PrimaryLink({
  href,
  active,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "text-[var(--color-foreground)]"
          : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      )}
    >
      {active ? (
        <motion.span
          layoutId="sidebar-primary-active"
          transition={{ type: "spring", duration: 0.4, bounce: 0.2 }}
          className="absolute inset-0 -z-0 rounded-xl bg-[var(--color-brand-soft)]"
        />
      ) : null}
      <span className="relative z-10 flex items-center gap-2">
        <span className={cn(active ? "text-[var(--color-brand)]" : "text-current")}>{icon}</span>
        <span>{label}</span>
      </span>
    </Link>
  );
}
