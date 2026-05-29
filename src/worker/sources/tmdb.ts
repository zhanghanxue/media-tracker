// TMDB (The Movie Database) REST client. UNLIKE AniList/Bangumi this runs in the
// WORKER, not the browser: TMDB requires an API key, and the project rule is that
// secret-bearing sources stay server-side (PLAN.md §400). The key (a v4 "API Read
// Access Token") is passed via the `apiKey` option as a Bearer header.
//
// Two operations: search by title (movie | tv) and fetch full detail by id. Detail
// appends `translations` in one request so the mapper can pull EN / 中文 / native
// titles without extra round-trips.

const TMDB_BASE = "https://api.themoviedb.org/3";

// Poster base. w500 is plenty for our card/cover sizes; the R2 re-host pipeline
// then caches whatever we hand it. `poster_path` already has a leading slash.
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 500;

export type TmdbKind = "movie" | "tv";

// Search result rows are partial — no translations, no runtime. Enough to render
// a picker; the add step fetches full detail.
export interface TmdbSearchResultRaw {
  id: number;
  title?: string; // movie
  name?: string; // tv
  original_title?: string; // movie
  original_name?: string; // tv
  original_language?: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string; // movie, "YYYY-MM-DD"
  first_air_date?: string; // tv
  origin_country?: string[];
}

interface TmdbSearchResponse {
  page: number;
  results: TmdbSearchResultRaw[];
  total_results: number;
  total_pages: number;
}

export interface TmdbTranslationItem {
  iso_639_1: string; // language, e.g. "en", "zh"
  iso_3166_1: string; // region, e.g. "US", "CN", "TW"
  data?: {
    title?: string; // movie
    name?: string; // tv
    overview?: string;
  };
}

export interface TmdbProductionCountry {
  iso_3166_1: string;
  name: string;
}

// A poster from the /images endpoint, tagged by language (iso_639_1 null =
// textless art). We prefer the poster whose language matches the work's origin
// so the cover shows the native-title key art, not the English/international one.
export interface TmdbImage {
  file_path: string;
  iso_639_1: string | null;
  vote_average?: number;
  vote_count?: number;
}

export interface TmdbImages {
  posters?: TmdbImage[];
}

// The unified detail shape (movie + tv fields both optional; `kind` tells the
// mapper which to read). Only the fields the mapper consumes are typed.
export interface TmdbDetail {
  id: number;

  // movie
  title?: string;
  original_title?: string;
  runtime?: number | null;
  release_date?: string;
  production_countries?: TmdbProductionCountry[];

  // tv
  name?: string;
  original_name?: string;
  number_of_episodes?: number | null;
  number_of_seasons?: number | null;
  episode_run_time?: number[];
  first_air_date?: string;
  seasons?: TmdbSeasonSummary[];

  // shared
  original_language?: string;
  overview?: string;
  poster_path?: string | null;
  origin_country?: string[];
  translations?: { translations: TmdbTranslationItem[] };
  images?: TmdbImages;
}

// A season as it appears in a show detail's `seasons[]`. season_number 0 is the
// "specials" bucket; some entries are upcoming (episode_count 0 / no air_date).
export interface TmdbSeasonSummary {
  season_number: number;
  name?: string;
  episode_count?: number;
  air_date?: string | null;
  poster_path?: string | null;
}

// The dedicated season endpoint (/tv/{id}/season/{n}?append_to_response=translations):
// carries the season name localized across languages + the episode list.
export interface TmdbSeasonDetail {
  id: number;
  season_number: number;
  name?: string;
  poster_path?: string | null;
  air_date?: string | null;
  episodes?: unknown[];
  translations?: { translations: TmdbTranslationItem[] };
  images?: TmdbImages;
}

export interface TmdbClientOptions {
  /** v4 API Read Access Token (Bearer). Required. */
  apiKey: string;
  /** Override fetch (tests). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Retries on HTTP 429. Defaults to 2. */
  retries?: number;
  /** Initial backoff in ms, doubles per retry. Defaults to 500. */
  backoffMs?: number;
  /** Localize top-level fields (e.g. season names) — e.g. "zh-CN". Detail/season
   * translations are always appended regardless, so titles stay multilingual. */
  language?: string;
  /** Also fetch posters across languages (append images + include_image_language)
   * so the mapper can pick the origin-language cover. Off by default (the seasons
   * picker doesn't need the heavier payload). */
  images?: boolean;
}

// Poster languages we ask TMDB for, covering the library's origins + textless.
const IMAGE_LANGUAGES = "zh,ja,ko,en,null";

export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TmdbError";
  }
}

/** Full poster URL from a TMDB `poster_path` (or null). */
export function tmdbPosterUrl(posterPath: string | null | undefined): string | null {
  return posterPath ? `${TMDB_IMAGE_BASE}${posterPath}` : null;
}

export async function searchTmdb(
  query: string,
  kind: TmdbKind,
  options: TmdbClientOptions,
): Promise<TmdbSearchResultRaw[]> {
  // language=zh-CN so results come back with Chinese titles where TMDB has them
  // (the user's library is Chinese-named); search still matches across original
  // + alternative titles regardless of this param.
  const params = new URLSearchParams({
    query,
    language: "zh-CN",
    include_adult: "false",
    page: "1",
  });
  const payload = await tmdbRequest<TmdbSearchResponse>(
    `/search/${kind}?${params.toString()}`,
    options,
  );
  return payload?.results ?? [];
}

export async function getTmdbDetail(
  id: number,
  kind: TmdbKind,
  options: TmdbClientOptions,
): Promise<TmdbDetail | null> {
  // Default language (en-US) gives a sensible English top-level title; the
  // `translations` block carries every localized title (we mine zh + en + keep
  // original_* for native). An explicit `language` localizes season names etc.
  const params = new URLSearchParams({
    append_to_response: options.images ? "translations,images" : "translations",
  });
  if (options.images) params.set("include_image_language", IMAGE_LANGUAGES);
  if (options.language) params.set("language", options.language);
  return tmdbRequest<TmdbDetail>(`/${kind}/${id}?${params.toString()}`, options, {
    notFoundIsNull: true,
  });
}

export async function getTmdbSeason(
  showId: number,
  seasonNumber: number,
  options: TmdbClientOptions,
): Promise<TmdbSeasonDetail | null> {
  const params = new URLSearchParams({
    append_to_response: options.images ? "translations,images" : "translations",
  });
  if (options.images) params.set("include_image_language", IMAGE_LANGUAGES);
  return tmdbRequest<TmdbSeasonDetail>(
    `/tv/${showId}/season/${seasonNumber}?${params.toString()}`,
    options,
    { notFoundIsNull: true },
  );
}

async function tmdbRequest<T>(
  path: string,
  options: TmdbClientOptions,
  { notFoundIsNull = false }: { notFoundIsNull?: boolean } = {},
): Promise<T | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;

  let attempt = 0;
  while (true) {
    const response = await fetchImpl(`${TMDB_BASE}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        Accept: "application/json",
      },
    });

    if (response.status === 429 && attempt < retries) {
      const retryAfter = response.headers.get("Retry-After");
      const retryAfterMs = retryAfter
        ? Number.parseFloat(retryAfter) * 1000
        : backoffMs * 2 ** attempt;
      await sleep(retryAfterMs);
      attempt += 1;
      continue;
    }

    if (notFoundIsNull && response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new TmdbError(
        `TMDB request failed: HTTP ${response.status}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
