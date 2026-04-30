"use client";

import { ShareLinkButton } from "@/components/trip/ShareLinkButton";
import { CloneTripButton } from "@/components/trip/CloneTripButton";
import { TripSwitcherRibbon } from "@/components/trip/TripSwitcherRibbon";
import { useI18n } from "@/components/providers/I18nProvider";
import type { Locale } from "@/lib/i18n/dictionaries";
import type { TripCurrency } from "@/lib/i18n/currency";

export function TripHeader({ title, tripId }: { title: string; tripId: string }) {
  const { locale, setLocale, currency, setCurrency, t } = useI18n();

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/90 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {title.trim() || t("app.name")}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("app.tagline")}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <span className="whitespace-nowrap">{t("header.language")}</span>
              <select
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
              >
                <option value="he">{t("header.localeHe")}</option>
                <option value="en">{t("header.localeEn")}</option>
                <option value="ru">{t("header.localeRu")}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <span className="whitespace-nowrap">{t("header.currency")}</span>
              <select
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as TripCurrency)}
              >
                <option value="ILS">{t("header.currencyILS")}</option>
                <option value="USD">{t("header.currencyUSD")}</option>
                <option value="EUR">{t("header.currencyEUR")}</option>
              </select>
            </label>
            <CloneTripButton />
            <ShareLinkButton />
          </div>
        </div>
      </header>
      <TripSwitcherRibbon currentTripId={tripId} currentTripTitle={title} />
    </>
  );
}
