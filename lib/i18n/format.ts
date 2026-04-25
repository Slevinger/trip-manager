import type { Locale } from "@/lib/i18n/dictionaries";

const localeMap: Record<Locale, string> = {
  he: "he-IL",
  en: "en-US",
  ru: "ru-RU",
};

export function formatDateForLocale(
  locale: Locale,
  value: string | Date | undefined,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  }
): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(localeMap[locale], options).format(d);
}

/** Format YYYY-MM-DD for display using local calendar fields. */
export function formatYmdForLocale(locale: Locale, ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return formatDateForLocale(locale, dt);
}
