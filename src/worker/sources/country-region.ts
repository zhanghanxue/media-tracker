// ISO-3166 alpha-2 country code → canonical `MediaRegion`. Shared by the AniList
// mapper (`countryOfOrigin`) and the TMDB mapper (`origin_country`) — extracted
// here once a second source needed it (the CLAUDE.md "abstract after the second
// use" rule). Unknown codes fall through to lowercase so we never drop data
// (e.g. "FR" → "fr" until someone curates a region for it).

import type { MediaRegion } from "../db/schema";

const COUNTRY_TO_REGION: Record<string, MediaRegion> = {
  JP: "japan",
  CN: "china",
  KR: "korea",
  TW: "taiwan",
  HK: "hong_kong",
  US: "usa",
  GB: "uk",
  TH: "thailand",
};

export function countryToRegion(code: string | null | undefined): MediaRegion | null {
  if (!code) return null;
  return COUNTRY_TO_REGION[code] ?? code.toLowerCase();
}
