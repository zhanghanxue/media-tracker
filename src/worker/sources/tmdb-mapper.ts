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
import { joinGenres } from "./genres";
import { isoFromString } from "./release-date";
import { ratingFrom10 } from "./rating";
import {
  tmdbPosterUrl,
  type TmdbDetail,
  type TmdbImage,
  type TmdbKind,
  type TmdbSeasonDetail,
  type TmdbSeasonSummary,
} from "./tmdb";

// Pick the poster whose language matches the work's origin (so the cover shows
// the native-title key art — e.g. the Chinese poster for a Chinese drama, not
// the English one). Highest-rated wins; falls back to TMDB's default poster.
function pickPosterPath(
  posters: TmdbImage[] | undefined,
  originalLanguage: string | null,
  fallback: string | null,
): string | null {
  if (originalLanguage && posters && posters.length > 0) {
    const matching = posters
      .filter((p) => p.iso_639_1 === originalLanguage)
      .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
    if (matching[0]) return matching[0].file_path;
  }
  return fallback;
}

export type TmdbMapperResult = MediaInsert;

/** TMDB's genres ride in the base detail response as `[{id, name}]`. */
export function extractTmdbGenres(detail: TmdbDetail): string[] {
  return (detail.genres ?? []).map((g) => g.name).filter(Boolean);
}

/**
 * The English title: prefer the explicit `en` translation, then fall back to the
 * base `title`/`name` field. The detail is fetched in en-US, so that base field
 * IS the English title — and English-origin titles often carry NO `en` entry in
 * `translations` (English is the original), which would otherwise leave it null.
 * Returns null only when neither source has a usable value.
 */
export function pickEnglishTitle(
  detail: TmdbDetail,
  kind: TmdbKind,
): string | null {
  const fromTranslation = pickTranslation(detail, kind, "en", null);
  if (fromTranslation) return fromTranslation;
  const base = kind === "movie" ? detail.title : detail.name;
  return blankToNull(base ?? null);
}

export function tmdbToMediaRow(
  detail: TmdbDetail,
  kind: TmdbKind,
  status: MediaStatus,
): TmdbMapperResult {
  const type = kind === "movie" ? "movie" : "drama";

  const titleNative =
    (kind === "movie" ? detail.original_title : detail.original_name) ?? null;
  const titleEnglish = pickEnglishTitle(detail, kind);
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

  const franchiseId =
    kind === "movie" ? (detail.belongs_to_collection?.id ?? null) : null;
  const collectionId =
    franchiseId === null ? null : `tmdb:collection:${franchiseId}`;

  return {
    type,
    region,
    title_native: blankToNull(titleNative),
    title_romaji: null, // TMDB has no romaji; it's an anime-specific concept.
    title_english: titleEnglish,
    title_chinese: titleChinese,
    status,
    is_rewatching: 0,
    cover_url: tmdbPosterUrl(
      pickPosterPath(
        detail.images?.posters,
        detail.original_language ?? null,
        detail.poster_path ?? null,
      ),
    ),
    external_id: `${kind}:${detail.id}`,
    external_source: "tmdb" satisfies ExternalSource,
    current_episode: null,
    total_episodes: totalEpisodes,
    current_chapter: null,
    total_chapters: null,
    runtime_minutes: runtimeMinutes,
    // movie → release_date; tv → first_air_date (the show's premiere).
    release_date: isoFromString(
      kind === "movie" ? detail.release_date : detail.first_air_date,
    ),
    source_rating: ratingFrom10(detail.vote_average), // already 0–10
    genres: joinGenres(extractTmdbGenres(detail)),
    platform: null, // game-only fields (IGDB)
    consumption_mode: null,
    // Franchise grouping: a movie in a TMDB collection (Rocky, Alien, …) joins
    // "tmdb:collection:<id>" so sequels land beside each other instead of as
    // loose cards. The route ensures the collection row exists before insert;
    // name stays null so the client auto-derives it from the members' titles.
    // Only movies — tv detail carries no belongs_to_collection, and a whole-show
    // add already groups its seasons under "tmdb:tv:<id>".
    collection_id: collectionId,
    // No ordinal in belongs_to_collection; the client falls back to date_added.
    sort_order: null,
  };
}

// Map ONE season of a TMDB tv show to a row, PRE-LINKED into the show's series.
// Titles are composed as "{show title} {season name}" per language so the
// grouped card's auto-derived name (common prefix of members) resolves to the
// show title in each language. series_name stays null (auto-derive); the season's
// own number drives ordering. `summary` is the matching entry from the show's
// seasons[] (episode_count + poster); `season` is the dedicated season fetch
// (localized name translations).
export function tmdbSeasonToMediaRow(
  show: TmdbDetail,
  summary: TmdbSeasonSummary,
  season: TmdbSeasonDetail | null,
  status: MediaStatus,
): TmdbMapperResult {
  const n = summary.season_number;
  const showNative = show.original_name ?? null;
  const showEnglish = pickEnglishTitle(show, "tv");
  const showChinese = pickTranslation(show, "tv", "zh", "CN");

  // Season name per language (from the season endpoint's translations), falling
  // back to the show-detail season summary name.
  const seasonEnglish = pickSeasonName(season, "en", null) ?? summary.name ?? null;
  // Fall back to the summary name too (else a failed season fetch would drop the
  // season label from the Chinese title and collapse every season to the show name).
  const seasonChinese = pickSeasonName(season, "zh", "CN") ?? summary.name ?? null;
  // Native season name = the show's original language, else the default name.
  const seasonNative =
    pickSeasonName(season, show.original_language ?? "", null) ??
    season?.name ??
    summary.name ??
    null;

  const region = countryToRegion(
    show.origin_country?.[0] ??
      show.production_countries?.[0]?.iso_3166_1 ??
      null,
  );

  return {
    type: "drama",
    region,
    title_native: compose(showNative, seasonNative),
    title_romaji: null,
    title_english: compose(showEnglish, seasonEnglish),
    title_chinese: compose(showChinese, seasonChinese),
    status,
    is_rewatching: 0,
    // Prefer the origin-language SEASON poster; fall back to the season summary
    // poster, then the season/show default.
    cover_url: tmdbPosterUrl(
      pickPosterPath(
        season?.images?.posters,
        show.original_language ?? null,
        summary.poster_path ?? season?.poster_path ?? show.poster_path ?? null,
      ),
    ),
    external_id: `tv:${show.id}:s${n}`,
    external_source: "tmdb" satisfies ExternalSource,
    current_episode: null,
    total_episodes: summary.episode_count ?? season?.episodes?.length ?? null,
    current_chapter: null,
    total_chapters: null,
    runtime_minutes: null,
    // The SEASON's air date (so seasons order chronologically among themselves),
    // falling back to the season fetch, then the show's premiere.
    release_date: isoFromString(
      summary.air_date ?? season?.air_date ?? show.first_air_date,
    ),
    // The show's rating (TMDB has no per-season score), so a season carries the
    // show's standing — better than leaving every season unrated.
    source_rating: ratingFrom10(show.vote_average),
    genres: joinGenres(extractTmdbGenres(show)), // genres live on the show, not the season
    platform: null, // game-only fields (IGDB)
    consumption_mode: null,
    // Pre-link every season into the show's collection ("tmdb:tv:<id>"); the
    // route ensures that collection row exists before insert. sort_order = the
    // season number so seasons order naturally. Collection name auto-derives.
    collection_id: `tmdb:tv:${show.id}`,
    sort_order: n,
  };
}

// "{show} {season}" with blanks handled; if only one is present, use it alone.
function compose(show: string | null, season: string | null): string | null {
  const s = blankToNull(show);
  const se = blankToNull(season);
  if (s && se) return `${s} ${se}`;
  return s ?? se;
}

function pickSeasonName(
  season: TmdbSeasonDetail | null,
  lang: string,
  preferRegion: string | null,
): string | null {
  if (!season || !lang) return null;
  const all = season.translations?.translations ?? [];
  const matches = all.filter((t) => t.iso_639_1 === lang);
  if (matches.length === 0) return null;
  const chosen =
    (preferRegion && matches.find((t) => t.iso_3166_1 === preferRegion)) ||
    matches[0]!;
  return blankToNull(chosen.data?.name ?? null);
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
