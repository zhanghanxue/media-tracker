// Pure mapping function: AniList `Media` → row insertable into D1's `media` table.
//
// Discriminator rules (per PLAN.md § Phase 3):
//   format === "NOVEL"                                       → type "light_novel"
//   format ∈ { MANGA, ONE_SHOT }                             → type "manga"
//   format ∈ { TV, TV_SHORT, MOVIE, SPECIAL, OVA, ONA, MUSIC } → type "animation"
//
// `status` is supplied by the caller; AniList doesn't know what the user wants
// to do with the item. `is_rewatching` defaults to 0 — toggled later via PATCH.

import type {
  ExternalSource,
  MediaInsert,
  MediaStatus,
  MediaType,
} from "../db/schema";
import type { AniListFormat, AniListMedia, AniListMediaType } from "./anilist";
import { countryToRegion } from "./country-region";

const ANIME_FORMATS = new Set<AniListFormat>([
  "TV",
  "TV_SHORT",
  "MOVIE",
  "SPECIAL",
  "OVA",
  "ONA",
  "MUSIC",
]);

const MANGA_FORMATS = new Set<AniListFormat>(["MANGA", "ONE_SHOT"]);

// The shared insert shape (schema.ts). Kept as a named alias because callers
// and tests reference AniListMapperResult specifically.
export type AniListMapperResult = MediaInsert;

export function aniListToMediaRow(
  detail: AniListMedia,
  status: MediaStatus,
): AniListMapperResult {
  const type = formatToType(detail.format, detail.type);

  const region = countryToRegion(detail.countryOfOrigin);

  const totalEpisodes = type === "animation" ? detail.episodes : null;
  // Light novels rarely populate `chapters`; volumes is the better signal.
  // Manga publishes by chapter; volumes is informational only.
  const totalChapters =
    type === "light_novel"
      ? (detail.chapters ?? detail.volumes)
      : type === "manga"
        ? detail.chapters
        : null;

  return {
    type,
    region,
    title_native: detail.title.native,
    title_romaji: detail.title.romaji,
    title_english: detail.title.english,
    title_chinese: null, // AniList doesn't ship Chinese titles; Bangumi enricher fills this in later.
    status,
    is_rewatching: 0,
    cover_url: detail.coverImage.extraLarge,
    external_id: String(detail.id),
    external_source: "anilist" satisfies ExternalSource,
    current_episode: null,
    total_episodes: totalEpisodes,
    current_chapter: null,
    total_chapters: totalChapters,
    runtime_minutes: null, // AniList doesn't model runtime; TMDB-only field.
    platform: null, // game-only fields (IGDB)
    consumption_mode: null,
    series_id: null,
    series_name: null,
    season_number: null,
  };
}

function formatToType(
  format: AniListFormat | null,
  mediaType?: AniListMediaType | null,
): MediaType {
  if (format === null) {
    // NOT_YET_RELEASED titles have no format yet. Fall back to the coarse
    // ANIME/MANGA type so they're still addable (e.g. an announced remake like
    // "THE ONE PIECE"). Can't distinguish light_novel from null, so MANGA → manga.
    if (mediaType === "ANIME") return "animation";
    if (mediaType === "MANGA") return "manga";
    throw new Error(
      "AniList detail is missing both `format` and `type` — cannot determine media type",
    );
  }
  if (format === "NOVEL") return "light_novel";
  if (MANGA_FORMATS.has(format)) return "manga";
  if (ANIME_FORMATS.has(format)) return "animation";
  // Runtime fallback if AniList adds a new format value we haven't taught the
  // type system about yet.
  throw new Error(`Unknown AniList format: ${String(format)}`);
}
