/**
 * Languages accepted by `photon.komoot.io` `lang=` (unsupported codes return 400).
 * UI locales such as `he` / `ru` are mapped to `en` for that query; the search route still
 * sends `Accept-Language` with the user’s locale for friendlier Photon/OSM behaviour where supported.
 */
export const PHOTON_LANG_CODES = ["default", "en", "de", "fr"] as const;
export type PhotonLangCode = (typeof PHOTON_LANG_CODES)[number];

export function isPhotonLangCode(value: string): value is PhotonLangCode {
  return (PHOTON_LANG_CODES as readonly string[]).includes(value);
}
