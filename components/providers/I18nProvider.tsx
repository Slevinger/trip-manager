"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type Locale } from "@/lib/i18n/dictionaries";
import { formatTripMoney, type TripCurrency } from "@/lib/i18n/currency";
import { useT } from "@/lib/i18n/useT";

const STORAGE_KEY = "trip-planner-locale";
const CURRENCY_STORAGE_KEY = "trip-planner-currency";

type I18nContextValue = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  currency: TripCurrency;
  setCurrency: (c: TripCurrency) => void;
  /** Format a numeric amount using current UI locale + selected currency. */
  formatMoney: (amount: number) => string;
  t: (key: string) => string;
  dir: "rtl" | "ltr";
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return "he";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "en" || raw === "ru" || raw === "he") return raw;
  return "he";
}

function readStoredCurrency(): TripCurrency {
  if (typeof window === "undefined") return "ILS";
  const raw = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
  if (raw === "ILS" || raw === "USD" || raw === "EUR") return raw;
  return "ILS";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());
  const [currency, setCurrencyState] = useState<TripCurrency>(() =>
    readStoredCurrency()
  );

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const setCurrency = useCallback((next: TripCurrency) => {
    setCurrencyState(next);
    try {
      window.localStorage.setItem(CURRENCY_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const formatMoney = useCallback(
    (amount: number) => formatTripMoney(amount, currency, locale),
    [currency, locale]
  );

  const dir: "rtl" | "ltr" = locale === "he" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const t = useT(locale);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      currency,
      setCurrency,
      formatMoney,
      t,
      dir,
    }),
    [locale, setLocale, currency, setCurrency, formatMoney, t, dir]
  );

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
