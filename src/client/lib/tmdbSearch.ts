// Client helpers for TMDB search. UNLIKE AniList/Bangumi (browser → source API
// directly), TMDB is key-bearing, so the browser hits the WORKER proxy
// (/api/tmdb/search) which holds the token. Pure display helpers live here too.

import {
  tmdbPosterUrl,
  type TmdbKind,
  type TmdbSearchResultRaw,
} from "../../worker/sources/tmdb";

export type { TmdbKind, TmdbSearchResultRaw };

export async function searchTmdbMedia(
  q: string,
  kind: TmdbKind,
  signal?: AbortSignal,
): Promise<TmdbSearchResultRaw[]> {
  const res = await fetch(
    `/api/tmdb/search?q=${encodeURIComponent(q)}&kind=${kind}`,
    { signal },
  );
  if (!res.ok) {
    throw new Error(`TMDB search failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { results: TmdbSearchResultRaw[] };
  return data.results;
}

/** Poster URL for a search result, or null. */
export function tmdbCover(item: TmdbSearchResultRaw): string | null {
  return tmdbPosterUrl(item.poster_path);
}

/** Localized display title (zh-CN where TMDB has it), falling back to original. */
export function tmdbDisplayTitle(item: TmdbSearchResultRaw): string {
  return (
    item.title ??
    item.name ??
    item.original_title ??
    item.original_name ??
    ""
  );
}

/** The original-language title, if it differs from the display title. */
export function tmdbOriginalTitle(item: TmdbSearchResultRaw): string | null {
  return item.original_title ?? item.original_name ?? null;
}

/** Release / first-air year as a string, or null. */
export function tmdbYear(item: TmdbSearchResultRaw): string | null {
  const date = item.release_date ?? item.first_air_date;
  return date ? date.slice(0, 4) : null;
}

export interface TmdbSeason {
  season_number: number;
  name: string | null;
  episode_count: number | null;
  air_date: string | null;
  poster_path: string | null;
}

/** The real seasons (>= 1) of a TMDB tv show, for the Add-modal season picker. */
export async function fetchTmdbSeasons(showId: number): Promise<TmdbSeason[]> {
  const res = await fetch(`/api/tmdb/tv/${showId}/seasons`);
  if (!res.ok) throw new Error(`TMDB seasons failed (HTTP ${res.status})`);
  const data = (await res.json()) as { seasons: TmdbSeason[] };
  return data.seasons;
}

export interface TmdbCollectionPartRow {
  id: number;
  title: string | null;
  release_date: string | null;
  poster_path: string | null;
  vote_average: number | null;
}

/** Every film TMDB files under a franchise, for the collection-gap scan. */
export async function fetchTmdbCollection(
  collectionId: number,
): Promise<{ name: string | null; parts: TmdbCollectionPartRow[] }> {
  const res = await fetch(`/api/tmdb/collection/${collectionId}`);
  if (!res.ok) throw new Error(`TMDB collection failed (HTTP ${res.status})`);
  return (await res.json()) as {
    name: string | null;
    parts: TmdbCollectionPartRow[];
  };
}

/**
 * Which of these TMDB external ids ("movie:550", "tv:1399:s2") the library
 * already tracks. Bounded to the ids asked about — never a whole-library fetch.
 */
export async function fetchTmdbExisting(
  externalIds: string[],
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  const res = await fetch(
    `/api/tmdb/existing?ids=${encodeURIComponent(externalIds.join(","))}`,
  );
  if (!res.ok) throw new Error(`TMDB existing check failed (HTTP ${res.status})`);
  const data = (await res.json()) as { existing: string[] };
  return new Set(data.existing);
}
