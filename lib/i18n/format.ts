import type { Locale } from "@/lib/i18n/dictionaries";
import {
  instantFromParts,
  parseDdMmYyyyCalendarDate,
  type TripDateTimeParts,
} from "@/lib/timeline/dates";

const localeMap: Record<Locale, string> = {
  he: "he-IL",
  en: "en-US",
  ru: "ru-RU",
};

/** Grouped display for numeric inputs (matches locale; e.g. commas in en-US). */
export function formatGroupedNumber(
  n: number,
  locale: Locale,
  options?: { maximumFractionDigits?: number }
): string {
  if (!Number.isFinite(n)) return "";
  const max = options?.maximumFractionDigits ?? 0;
  return new Intl.NumberFormat(localeMap[locale], {
    useGrouping: true,
    maximumFractionDigits: max,
    minimumFractionDigits: 0,
  }).format(n);
}

/**
 * Parse a typed amount after stripping spaces and thousands separators.
 * Treats a single comma with 1–2 digit suffix as decimal comma (e.g. "12,5").
 */
export function parseGroupedNumberInput(raw: string): number | null {
  let s = raw.replace(/[\s\u00a0\u202f]/g, "").replace(/'/g, "");
  if (s === "" || s === "-" || s === "." || s === ",") return null;

  const hasDot = s.includes(".");
  const commaIdx = s.indexOf(",");
  const lastComma = s.lastIndexOf(",");

  if (!hasDot && commaIdx !== -1 && commaIdx === lastComma) {
    const after = s.slice(commaIdx + 1);
    if (after.length > 0 && after.length <= 2 && /^\d+$/.test(after)) {
      s = `${s.slice(0, commaIdx).replace(/,/g, "")}.${after}`;
    } else {
      s = s.replace(/,/g, "");
    }
  } else {
    s = s.replace(/,/g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

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

/** Local calendar date as YYYY-MM-DD (user's timezone). */
export function localCalendarYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format stored `dd-mm-yyyy` + optional `HH:mm` for display. */
export function formatTripDateTimeForLocale(
  locale: Locale,
  dateDdMmYyyy: string,
  timeHhMm: string
): string {
  const parts: TripDateTimeParts = {
    date: dateDdMmYyyy.trim(),
    time: timeHhMm.trim(),
  };
  if (!parts.date) return "";
  const inst = instantFromParts(parts);
  if (!inst || Number.isNaN(inst.getTime())) return parts.date;
  if (!parts.time) {
    const d0 = parseDdMmYyyyCalendarDate(parts.date);
    return d0 ? formatDateForLocale(locale, d0) : parts.date;
  }
  return formatDateForLocale(locale, inst, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
