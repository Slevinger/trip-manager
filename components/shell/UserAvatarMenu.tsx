"use client";

import type { User } from "firebase/auth";
import { signOut } from "firebase/auth";
import { LogOut, User as UserIcon, Sparkles } from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { getClientAuth } from "@/lib/firebase";
import { signInWithGoogle } from "@/lib/googleSignIn";
import { Avatar, AvatarFallback, AvatarImage, avatarInitials } from "@/components/ui/avatar";
import pkg from "@/package.json";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserAvatarMenu({ user }: { user: User | null }) {
  const { t } = useI18n();

  if (!user) {
    return (
      <Button
        variant="primary"
        size="sm"
        onClick={() => void signInWithGoogle()}
        className="gap-2"
      >
        <Sparkles className="h-4 w-4" />
        {t("common.signInWithGoogle")}
      </Button>
    );
  }

  const name = user.displayName?.trim() || user.email || "";

  async function handleSignOut() {
    const auth = getClientAuth();
    if (!auth) return;
    await signOut(auth);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("shell.account")}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
        >
          <Avatar className="h-9 w-9">
            {user.photoURL ? <AvatarImage src={user.photoURL} alt={name} /> : null}
            <AvatarFallback>{avatarInitials(name)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-semibold text-[var(--color-foreground)]">
            {name || t("common.signedIn")}
          </span>
          <span className="block truncate text-[11px] font-normal normal-case text-[var(--color-muted-foreground)]">
            {user.email}
          </span>
          <span className="block text-[10px] font-normal normal-case text-[var(--color-muted-foreground)] opacity-50">
            v{pkg.version}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserIcon className="h-4 w-4" /> {t("shell.profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleSignOut()} className="text-[var(--color-danger)]">
          <LogOut className="h-4 w-4" /> {t("shell.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
