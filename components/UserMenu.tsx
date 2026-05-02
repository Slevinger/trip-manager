"use client";

import type { User } from "firebase/auth";
import { signOut } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { ProfilePreferencesDialog } from "@/components/ProfilePreferencesDialog";
import { sessionIsGoogleSignIn } from "@/lib/canonicalTripsFirestore";
import { getClientAuth } from "@/lib/firebase";
import { useI18n } from "@/lib/i18n/context";
import type { UserPreferences } from "@/lib/types/trip";
import {
  bootstrapUserOnSignIn,
  normalizeUserEmailKey,
  subscribeUser,
  updateUserPreferences,
} from "@/lib/usersFirestore";
import type { AppUser } from "@/lib/types/user";

const EMPTY_PREFS: UserPreferences = { hobbies: [], activities: [], lifestyle: [] };

export function UserMenu({ user }: { user: User }) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const email = user.email?.trim() ?? "";
  const emailLower = email ? normalizeUserEmailKey(email) : "";
  const initial = user.displayName?.trim()?.[0]?.toUpperCase() ?? email[0]?.toUpperCase() ?? "?";

  useEffect(() => {
    if (!emailLower) return;
    let cancelled = false;
    void sessionIsGoogleSignIn(user).then((ok) => {
      if (!ok || cancelled) return;
      void bootstrapUserOnSignIn(user).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [user, emailLower]);

  useEffect(() => {
    if (!emailLower) return () => {};
    return subscribeUser(emailLower, setAppUser);
  }, [emailLower]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  async function handleSignOut() {
    const auth = getClientAuth();
    if (!auth) return;
    await signOut(auth);
    setMenuOpen(false);
  }

  const prefs = appUser?.preferences ?? EMPTY_PREFS;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-zinc-100 text-sm font-semibold text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        title={email || user.uid}
        aria-expanded={menuOpen}
        aria-haspopup="true"
      >
        {initial}
      </button>

      {menuOpen ? (
        <div className="absolute right-0 z-[60] mt-1 w-56 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-50">
              {user.displayName?.trim() || t("common.signedIn")}
            </p>
            <p className="truncate text-[10px] text-zinc-500">{email || user.uid}</p>
          </div>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-xs text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
            onClick={() => {
              setMenuOpen(false);
              setProfileOpen(true);
            }}
          >
            {t("userMenu.profilePreferences")}
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            onClick={() => void handleSignOut()}
          >
            {t("userMenu.signOut")}
          </button>
        </div>
      ) : null}

      <ProfilePreferencesDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        initial={prefs}
        onSave={async (next) => {
          if (!emailLower) return;
          await updateUserPreferences(emailLower, next);
        }}
      />
    </div>
  );
}
