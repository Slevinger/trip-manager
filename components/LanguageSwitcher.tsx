"use client";

import { useI18n } from "@/lib/i18n/context";
import type { SupportedLocale } from "@/lib/i18n/messages";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  function pick(next: SupportedLocale) {
    if (next !== locale) setLocale(next);
  }

  return (
    <div
      className="flex items-center rounded-lg border border-zinc-200 p-0.5 text-xs dark:border-zinc-700"
      role="group"
      aria-label={t("common.language")}
    >
      <button
        type="button"
        onClick={() => pick("en")}
        className={
          locale === "en"
            ? "rounded-md bg-white px-2.5 py-1 font-semibold shadow dark:bg-zinc-800"
            : "rounded-md px-2.5 py-1 text-zinc-600 dark:text-zinc-400"
        }
      >
        {t("lang.en")}
      </button>
      <button
        type="button"
        onClick={() => pick("he")}
        className={
          locale === "he"
            ? "rounded-md bg-white px-2.5 py-1 font-semibold shadow dark:bg-zinc-800"
            : "rounded-md px-2.5 py-1 text-zinc-600 dark:text-zinc-400"
        }
      >
        {t("lang.he")}
      </button>
      <button
        type="button"
        onClick={() => pick("ru")}
        className={
          locale === "ru"
            ? "rounded-md bg-white px-2.5 py-1 font-semibold shadow dark:bg-zinc-800"
            : "rounded-md px-2.5 py-1 text-zinc-600 dark:text-zinc-400"
        }
      >
        {t("lang.ru")}
      </button>
    </div>
  );
}
