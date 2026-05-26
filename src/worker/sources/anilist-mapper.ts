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
  MediaRegion,
  MediaRow,
  MediaStatus,
  MediaType,
} from "../db/schema";
import type { AniListFormat, AniListMedia } from "./anilist";

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

// ISO-3166 alpha-2 → canonical region string. Unknown codes fall through to
// lowercase so we never lose data (e.g. "TH" → "th" until someone curates).
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

export type AniListMapperResult = Pick<
  MediaRow,
  | "type"
  | "region"
  | "title_native"
  | "title_romaji"
  | "title_english"
  | "title_chinese"
  | "status"
  | "is_rewatching"
  | "cover_url"
  | "external_id"
  | "external_source"
  | "current_episode"
  | "total_episodes"
  | "current_chapter"
  | "total_chapters"
>;

export function aniListToMediaRow(
  detail: AniListMedia,
  status: MediaStatus,
): AniListMapperResult {
  const type = formatToType(detail.format);

  const region = detail.countryOfOrigin
    ? (COUNTRY_TO_REGION[detail.countryOfOrigin] ??
      detail.countryOfOrigin.toLowerCase())
    : null;

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
  };
}

function formatToType(format: AniListFormat | null): MediaType {
  if (format === null) {
    throw new Error(
      "AniList detail is missing `format` — cannot determine media type",
    );
  }
  if (format === "NOVEL") return "light_novel";
  if (MANGA_FORMATS.has(format)) return "manga";
  if (ANIME_FORMATS.has(format)) return "animation";
  // Runtime fallback if AniList adds a new format value we haven't taught the
  // type system about yet.
  throw new Error(`Unknown AniList format: ${String(format)}`);
}
