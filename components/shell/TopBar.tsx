"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Compass } from "lucide-react";
import type { User } from "firebase/auth";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { UserAvatarMenu } from "./UserAvatarMenu";

interface TopBarProps {
  tripId: string | null;
  tripTitle?: string | null;
  user: User | null;
}

export function TopBar({ tripId, tripTitle, user }: TopBarProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const rtlChevron = locale === "he";

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-4 sm:gap-3 lg:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
          <Link
            href={tripId ? `/trip/${tripId}` : "/"}
            className="flex min-w-0 items-center gap-2"
            aria-label={tripId ? t("shell.tripHomeAria") : t("shell.appHomeAria")}
          >
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-gradient-brand text-white shadow-[var(--shadow-soft)]"
            >
              <Compass className="h-4 w-4" />
            </span>
            <span className="min-w-0 truncate text-sm font-semibold tracking-tight">Wander</span>
          </Link>
          {tripId ? (
            <button
              type="button"
              onClick={() => router.push("/")}
              aria-label={t("shell.leaveTripAria")}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)]/80 px-2.5 py-1.5 text-xs font-semibold tracking-tight text-[var(--color-foreground)] shadow-sm backdrop-blur-sm transition-colors hover:border-[var(--color-brand)]/35 hover:bg-[var(--color-brand-soft)]",
                rtlChevron && "flex-row-reverse"
              )}
            >
              <ChevronLeft
                className={cn("h-3.5 w-3.5 shrink-0 opacity-80", rtlChevron && "rotate-180")}
                aria-hidden
              />
              <span>{t("shell.leaveTrip")}</span>
            </button>
          ) : null}
        </div>

        <nav className="hidden flex-1 flex-wrap items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] lg:flex">
          <Link href="/" className="font-medium hover:text-[var(--color-foreground)]">
            {t("shell.dashboard")}
          </Link>
          {tripId ? (
            <>
              <ChevronRight
                className={cn("h-3.5 w-3.5 shrink-0 opacity-60", rtlChevron && "rotate-180")}
                aria-hidden
              />
              <button
                type="button"
                onClick={() => router.push(`/trip/${tripId}`)}
                className="max-w-[min(28ch,40vw)] truncate font-semibold text-[var(--color-foreground)] hover:underline"
              >
                {tripTitle?.trim() || t("dashboard.openTrip")}
              </button>
              <ChevronRight
                className={cn("h-3.5 w-3.5 shrink-0 opacity-60", rtlChevron && "rotate-180")}
                aria-hidden
              />
              <Link
                href="/"
                aria-label={t("shell.leaveTripAria")}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)]/60 px-3 py-1 text-xs font-semibold text-[var(--color-foreground)] transition-colors hover:border-[var(--color-brand)]/40 hover:bg-[var(--color-brand-soft)]"
              >
                {t("shell.leaveTrip")}
              </Link>
            </>
          ) : null}
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          <UserAvatarMenu user={user} />
        </div>
      </div>
    </header>
  );
}
