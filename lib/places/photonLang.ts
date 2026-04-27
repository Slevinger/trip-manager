import type { Locale } from "@/lib/i18n/dictionaries";

/**
 * Languages accepted by `photon.komoot.io` (see Photon API docs; unsupported codes return 400).
 */
export const PHOTON_LANG_CODES = ["default", "en", "de", "fr"] as const;
export type PhotonLangCode = (typeof PHOTON_LANG_CODES)[number];

export function isPhotonLangCode(value: string): value is PhotonLangCode {
  return (PHOTON_LANG_CODES as readonly string[]).includes(value);
}

/**
 * Map app UI locale → Photon `lang` (English vs regional/default names from OSM).
 */
export function photonLangForAppLocale(locale: Locale): PhotonLangCode {
  if (locale === "en") return "en";
  if (locale === "he" || locale === "ru") return "default";
  return "en";
}
