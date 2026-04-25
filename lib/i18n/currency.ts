import type { Locale } from "@/lib/i18n/dictionaries";

export type TripCurrency = "ILS" | "USD" | "EUR";

export const TRIP_CURRENCIES: readonly TripCurrency[] = ["ILS", "USD", "EUR"];

export function numberLocaleFor(uiLocale: Locale): string {
  if (uiLocale === "he") return "he-IL";
  if (uiLocale === "ru") return "ru-RU";
  return "en-US";
}

export function formatTripMoney(
  amount: number,
  currency: TripCurrency,
  uiLocale: Locale
): string {
  return new Intl.NumberFormat(numberLocaleFor(uiLocale), {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
