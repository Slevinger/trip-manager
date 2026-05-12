import type { MessageKey, SupportedLocale } from "@/lib/i18n/messages";
import { tripInstantMs } from "@/lib/tripViewPhase";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

const LOCALE_TAG: Record<SupportedLocale, string> = {
  en: "en-US",
  he: "he-IL",
  ru: "ru-RU",
};

/** Trip hub hero + cards: localized start/end with {@link MessageKey} `tripHero.dates`. */
export function formatTripHeroDateRangeLine(
  startIso: string,
  endIso: string,
  locale: SupportedLocale,
  t: TFn
): string {
  const a = tripInstantMs(startIso);
  const b = tripInstantMs(endIso);
  if (a == null || b == null) return "—";
  const aDate = new Date(a);
  const bDate = new Date(b);
  const tag = LOCALE_TAG[locale];
  const sameYear = aDate.getFullYear() === bDate.getFullYear();
  const start = aDate.toLocaleDateString(tag, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" as const }),
  });
  const end = bDate.toLocaleDateString(tag, { month: "short", day: "numeric", year: "numeric" });
  return t("tripHero.dates", { start, end });
}
