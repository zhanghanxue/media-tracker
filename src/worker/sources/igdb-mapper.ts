// Pure mapping: an IGDB game → an insertable `media` row (type "game").
//
// IGDB gives one `name` (usually the English/romanized title); we store it as
// title_english so it displays in both UI languages (the zh fallback chain ends
// there). Games have no region in our sense → null. The two game-specific fields
// come from the ADD REQUEST, not IGDB: consumption_mode (Playing vs Watching,
// chosen via the add toggle) drives the card's tracking model, and platform is
// the user-confirmed bucket (auto-filled from IGDB's platforms in the browser,
// then sent here). game_progress starts null.

import type {
  ExternalSource,
  MediaConsumptionMode,
  MediaInsert,
  MediaPlatform,
  MediaRegion,
  MediaStatus,
} from "../db/schema";
import { extractIgdbGenres, igdbCoverUrl, type IgdbGame } from "./igdb";
import { joinGenres } from "./genres";
import { isoFromUnixSeconds } from "./release-date";
import { ratingFrom100 } from "./rating";

export type IgdbMapperResult = MediaInsert;

// ISO 3166-1 numeric country codes → our region buckets (IGDB stores
// company.country this way). Only the regions we surface; anything else → null.
const COUNTRY_NUM_TO_REGION: Record<number, MediaRegion> = {
  392: "japan",
  156: "china",
  410: "korea",
  158: "taiwan",
  344: "hong_kong",
  840: "usa",
  826: "uk",
  764: "thailand",
};

// A game's region = the developer's country (best origin signal), falling back
// to the publisher's, then any involved company with a known country. Null when
// IGDB has no usable country — the editor can set one.
function igdbRegion(game: IgdbGame): MediaRegion | null {
  const companies = game.involved_companies ?? [];
  const pick = (filter: (c: (typeof companies)[number]) => boolean) => {
    for (const c of companies) {
      const code = c.company?.country;
      if (filter(c) && typeof code === "number" && COUNTRY_NUM_TO_REGION[code]) {
        return COUNTRY_NUM_TO_REGION[code];
      }
    }
    return null;
  };
  return (
    pick((c) => c.developer === true) ??
    pick((c) => c.publisher === true) ??
    pick(() => true)
  );
}

export interface IgdbMapOptions {
  status: MediaStatus;
  consumptionMode: MediaConsumptionMode;
  platform: MediaPlatform | null;
  // The browser-supplied (OpenCC-normalized) Chinese title; when absent the
  // mapper derives one from IGDB's alternative_names (un-normalized).
  titleChinese?: string | null;
}

// A Chinese title from IGDB's alternative_names: ≥2 Han ideographs and NO kana
// (kana ⇒ the Japanese title). Server-side fallback for when the browser didn't
// pass one — un-normalized, so it may be Traditional; the browser path prefers
// Simplified via OpenCC.
function pickChineseTitle(game: IgdbGame): string | null {
  const candidates = (game.alternative_names ?? [])
    .map((a) => (a.name ?? "").trim())
    .filter(
      (s) => (s.match(/[㐀-鿿]/g) ?? []).length >= 2 && !/[぀-ヿ]/.test(s),
    );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => a.length - b.length)[0]!;
}

export function igdbToMediaRow(
  game: IgdbGame,
  opts: IgdbMapOptions,
): IgdbMapperResult {
  const name = game.name?.trim();
  return {
    type: "game",
    region: igdbRegion(game), // developer's country (best-effort); editor can fix
    title_native: null,
    title_romaji: null,
    title_english: name ? name : null,
    // Browser-supplied (Simplified) Chinese title wins; else derive from IGDB's
    // alternative_names. A Chinese game now keeps its Chinese title + stays
    // searchable in Chinese, instead of landing English-only.
    title_chinese: opts.titleChinese ?? pickChineseTitle(game),
    status: opts.status,
    is_rewatching: 0,
    cover_url: igdbCoverUrl(game.cover?.image_id),
    external_id: String(game.id),
    external_source: "igdb" satisfies ExternalSource,
    current_episode: null,
    total_episodes: null,
    current_chapter: null,
    total_chapters: null,
    runtime_minutes: null,
    release_date: isoFromUnixSeconds(game.first_release_date), // Unix seconds → ISO
    source_rating: ratingFrom100(game.rating), // 0–100 → 0–10
    genres: joinGenres(extractIgdbGenres(game)),
    platform: opts.platform,
    consumption_mode: opts.consumptionMode,
    collection_id: null,
    sort_order: null,
  };
}
