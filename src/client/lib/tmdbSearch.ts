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
): Promise<TmdbSearchResultRaw[]> {
  const res = await fetch(
    `/api/tmdb/search?q=${encodeURIComponent(q)}&kind=${kind}`,
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
