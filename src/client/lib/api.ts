// Thin fetch wrapper for the media API. Returns parsed JSON or throws on a
// non-2xx (React Query turns the throw into `error` state).

import {
  searchAniList,
  type AniListMedia,
  type AniListMediaType,
} from "../../worker/sources/anilist";
import type { BangumiSubject } from "../../worker/sources/bangumi";
import type { TmdbAddRef, IgdbAddRef } from "../../worker/api/validation";
import type { SortKey } from "../../worker/api/list-query";
import type { MediaStatus } from "../../worker/db/schema";
import type { MediaListResponse, MediaRow } from "./types";

export type { SortKey };

export interface MediaFilters {
  types: string[];
  regions: string[];
  statuses: string[];
  genres: string[];
  q: string;
  sort: SortKey;
  // Drill-down scope: a collection id restricts to that level's direct items;
  // COLLECTION_ROOT to loose items; undefined/null = unscoped (whole library).
  collection?: string | null;
}

// Loose-items sentinel (mirrors the Worker's COLLECTION_ROOT) — selects items in
// no collection (the root level of the drill-down).
export const COLLECTION_ROOT = "__root__";

// Default page size for a level's item grid. Small + paginated (offset) so the
// Worker never serializes the whole library in one request — that O(library)
// response was blowing the Worker CPU limit once the library passed ~3.5k rows.
export const LEVEL_PAGE_SIZE = 60;

export function buildMediaQueryString(
  filters: MediaFilters,
  page?: { limit: number; offset: number },
): string {
  const params = new URLSearchParams();
  for (const t of filters.types) params.append("type", t);
  for (const r of filters.regions) params.append("region", r);
  for (const s of filters.statuses) params.append("status", s);
  for (const g of filters.genres) params.append("genre", g);
  const q = filters.q.trim();
  if (q) params.set("q", q);
  if (filters.collection) params.set("collection", filters.collection);
  // Default (date_updated) is the server default — omit it to keep URLs clean.
  if (filters.sort && filters.sort !== "date_updated") {
    params.set("sort", filters.sort);
  }
  if (page) {
    params.set("limit", String(page.limit));
    params.set("offset", String(page.offset));
  }
  return params.toString();
}

// Dynamic genre facets, scoped to the selected media types (empty = whole
// library). Server-computed because the client only loads a slice of rows.
export interface GenreFacet {
  value: string;
  count: number;
}

export async function fetchMediaFacets(types: string[]): Promise<GenreFacet[]> {
  const params = new URLSearchParams();
  for (const t of types) params.append("type", t);
  const qs = params.toString();
  const res = await fetch(`/api/media/facets${qs ? `?${qs}` : ""}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { genres: GenreFacet[] };
  return data.genres;
}

// Legacy whole-library limit — still used by the collection/detail editors,
// which derive names over the full library. TODO: migrate those to rollups too;
// the main list no longer uses this (it paginates via fetchMediaPage).
const LIBRARY_PAGE_SIZE = 5000;

export async function fetchMediaList(
  filters: MediaFilters,
): Promise<MediaListResponse> {
  return fetchMediaPage(filters, { limit: LIBRARY_PAGE_SIZE, offset: 0 });
}

export async function fetchMediaPage(
  filters: MediaFilters,
  page: { limit: number; offset: number },
): Promise<MediaListResponse> {
  const qs = buildMediaQueryString(filters, page);
  const res = await fetch(`/api/media${qs ? `?${qs}` : ""}`);
  if (!res.ok) {
    throw new Error(`Failed to load media (HTTP ${res.status})`);
  }
  return (await res.json()) as MediaListResponse;
}

// --- Drill-down support (collection rollups + filtered match set) -----------

export interface CollectionRollupTitles {
  title_native: string | null;
  title_romaji: string | null;
  title_english: string | null;
  title_chinese: string | null;
}

export interface CollectionRollup {
  collection_id: string;
  direct_count: number;
  completed_count: number;
  planned_count: number;
  // Direct items of type 'game' in this collection (rolled up into the subtree
  // `games` aggregate). Informational — the completion bar is shown for all
  // collection types including all-game ones.
  game_count: number;
  latest_updated: string | null;
  earliest_release: string | null;
  sample_cover: string | null;
  sample_titles: CollectionRollupTitles[];
}

/** Per-collection rollups (counts/dates/cover/name-samples) — O(#collections),
 *  so the client renders collection cards without loading the whole library. */
export async function fetchCollectionRollups(): Promise<CollectionRollup[]> {
  const res = await fetch("/api/collections/rollups");
  if (!res.ok) throw new Error(`Failed to load rollups (HTTP ${res.status})`);
  const { rollups } = (await res.json()) as { rollups: CollectionRollup[] };
  return rollups;
}

/** Collection ids whose direct items match the active filters — used while
 *  filtering to decide which collection cards to surface, without the items. */
export async function fetchMatchingCollections(
  filters: MediaFilters,
): Promise<string[]> {
  const qs = buildMediaQueryString({
    ...filters,
    collection: null,
    sort: "date_updated",
  });
  const res = await fetch(`/api/media/matching-collections${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`Failed to load matches (HTTP ${res.status})`);
  const { collection_ids } = (await res.json()) as { collection_ids: string[] };
  return collection_ids;
}

// --- AniList search + add -------------------------------------------------
//
// Search runs in the BROWSER, hitting AniList directly (it allows CORS, and the
// user's own IP isn't blocked the way Cloudflare Worker egress is). The Worker
// is only asked which results are already in the library.

export type SearchType = AniListMediaType; // "ANIME" | "MANGA"

export type AniListSearchItem = AniListMedia & { alreadyAdded: boolean };

export interface AniListSearchResponse {
  results: AniListSearchItem[];
}

// Best-effort library-membership lookup; if it fails, the search still renders
// (every result just shows as not-added).
async function fetchExistingIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const qs = ids.map((id) => encodeURIComponent(id)).join(",");
  const res = await fetch(`/api/anilist/existing?ids=${qs}`);
  if (!res.ok) return new Set();
  const data = (await res.json()) as { existing: string[] };
  return new Set(data.existing);
}

export async function searchAniListMedia(
  q: string,
  type: SearchType,
): Promise<AniListSearchResponse> {
  // perPage 25 (vs the client default of 10) gives relevance-tail headroom so a
  // result just past the top 10 still shows. AniList caps perPage at 50.
  const results = await searchAniList(q, type, { perPage: 25 }); // browser → AniList (CORS)
  const existing = await fetchExistingIds(results.map((r) => String(r.id)));
  return {
    results: results.map((media) => ({
      ...media,
      alreadyAdded: existing.has(String(media.id)),
    })),
  };
}

// The browser fetched the source object and POSTs it; the Worker maps + persists.
// TMDB is the exception: the browser sends only { id, media_type } and the Worker
// (key holder) fetches full detail before mapping.
export type AddMediaInput =
  | { external_source: "anilist"; status: MediaStatus; media: AniListMedia }
  | { external_source: "bangumi"; status: MediaStatus; media: BangumiSubject }
  | { external_source: "tmdb"; status: MediaStatus; media: TmdbAddRef }
  | { external_source: "igdb"; status: MediaStatus; media: IgdbAddRef };

export async function addMedia(input: AddMediaInput): Promise<MediaRow> {
  const res = await fetch("/api/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  // 201 = inserted; 409 = already in library (server returns the existing row).
  // Both mean "it's in the library now", so treat 409 as success.
  if (!res.ok && res.status !== 409) {
    throw new Error(`Add failed (HTTP ${res.status})`);
  }
  return (await res.json()) as MediaRow;
}
