/**
 * Languages accepted by `photon.komoot.io` (unsupported codes return 400).
 */
export const PHOTON_LANG_CODES = ["default", "en", "de", "fr"] as const;
export type PhotonLangCode = (typeof PHOTON_LANG_CODES)[number];

export function isPhotonLangCode(value: string): value is PhotonLangCode {
  return (PHOTON_LANG_CODES as readonly string[]).includes(value);
}
