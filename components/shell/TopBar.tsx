"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Compass } from "lucide-react";
import type { User } from "firebase/auth";
import { useI18n } from "@/lib/i18n/context";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { UserAvatarMenu } from "./UserAvatarMenu";

interface TopBarProps {
  tripId: string | null;
  tripTitle?: string | null;
  user: User | null;
}

export function TopBar({ tripId, tripTitle, user }: TopBarProps) {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
        <Link href="/" className="flex items-center gap-2 lg:hidden">
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-2xl bg-gradient-brand text-white shadow-[var(--shadow-soft)]"
          >
            <Compass className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Wander</span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] lg:flex">
          <Link href="/" className="font-medium hover:text-[var(--color-foreground)]">
            {t("shell.dashboard")}
          </Link>
          {tripId ? (
            <>
              <ChevronRight className="h-3.5 w-3.5" />
              <button
                type="button"
                onClick={() => router.push(`/trip/${tripId}`)}
                className="max-w-[28ch] truncate font-semibold text-[var(--color-foreground)] hover:underline"
              >
                {tripTitle?.trim() || t("dashboard.openTrip")}
              </button>
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
