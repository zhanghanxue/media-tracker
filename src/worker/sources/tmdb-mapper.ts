// Pure mapping: a TMDB detail object → a row insertable into D1's `media` table.
//
// Type discriminator (PRD.md § source→type): TMDB `movie` → "movie",
// TMDB `tv` → "drama". (Western/CN animated series also arrive as `tv`; v1 files
// them under "drama" and the user can re-type in the editor — genre-based
// animation detection is a deliberate non-goal here.)
//
// Titles: TMDB localizes per request, but a single detail call with
// `append_to_response=translations` carries every variant, so we mine:
//   native  = original_title / original_name (the original-language title)
//   english = the `en` translation
//   chinese = the `zh-CN` translation (already Simplified — no OpenCC needed;
//             zh-TW/HK are Traditional, used only as a fallback)
//
// `external_id` is `"${kind}:${id}"` because TMDB movie ids and tv ids share a
// numeric space (movie 603 ≠ tv 603) — the kind prefix keeps the conflict key unique.

import type { ExternalSource, MediaInsert, MediaStatus } from "../db/schema";
import { countryToRegion } from "./country-region";
import { tmdbPosterUrl, type TmdbDetail, type TmdbKind } from "./tmdb";

export type TmdbMapperResult = MediaInsert;

export function tmdbToMediaRow(
  detail: TmdbDetail,
  kind: TmdbKind,
  status: MediaStatus,
): TmdbMapperResult {
  const type = kind === "movie" ? "movie" : "drama";

  const titleNative =
    (kind === "movie" ? detail.original_title : detail.original_name) ?? null;
  const titleEnglish = pickTranslation(detail, kind, "en", null);
  const titleChinese = pickTranslation(detail, kind, "zh", "CN");

  const region = countryToRegion(
    detail.origin_country?.[0] ??
      detail.production_countries?.[0]?.iso_3166_1 ??
      null,
  );

  // movie: a single runtime; tv: per-episode runtime (first entry) + an episode total.
  const runtimeMinutes =
    kind === "movie"
      ? (detail.runtime ?? null)
      : (firstPositive(detail.episode_run_time) ?? null);
  const totalEpisodes =
    kind === "tv" ? (detail.number_of_episodes ?? null) : null;

  return {
    type,
    region,
    title_native: blankToNull(titleNative),
    title_romaji: null, // TMDB has no romaji; it's an anime-specific concept.
    title_english: titleEnglish,
    title_chinese: titleChinese,
    status,
    is_rewatching: 0,
    cover_url: tmdbPosterUrl(detail.poster_path),
    external_id: `${kind}:${detail.id}`,
    external_source: "tmdb" satisfies ExternalSource,
    current_episode: null,
    total_episodes: totalEpisodes,
    current_chapter: null,
    total_chapters: null,
    runtime_minutes: runtimeMinutes,
  };
}

// Find the localized title for `lang`, preferring a specific region (e.g. "CN"
// for Simplified Chinese) but accepting any region of that language otherwise.
// Returns null when absent or blank.
function pickTranslation(
  detail: TmdbDetail,
  kind: TmdbKind,
  lang: string,
  preferRegion: string | null,
): string | null {
  const all = detail.translations?.translations ?? [];
  const matches = all.filter((t) => t.iso_639_1 === lang);
  if (matches.length === 0) return null;

  const chosen =
    (preferRegion && matches.find((t) => t.iso_3166_1 === preferRegion)) ||
    matches[0]!;
  const value = kind === "movie" ? chosen.data?.title : chosen.data?.name;
  return blankToNull(value ?? null);
}

function blankToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function firstPositive(values: number[] | undefined): number | null {
  if (!values) return null;
  for (const v of values) {
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
}
