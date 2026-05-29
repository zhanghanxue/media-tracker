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
  q: string;
  sort: SortKey;
}

export function buildMediaQueryString(filters: MediaFilters): string {
  const params = new URLSearchParams();
  for (const t of filters.types) params.append("type", t);
  for (const r of filters.regions) params.append("region", r);
  for (const s of filters.statuses) params.append("status", s);
  const q = filters.q.trim();
  if (q) params.set("q", q);
  // Default (date_updated) is the server default — omit it to keep URLs clean.
  if (filters.sort && filters.sort !== "date_updated") {
    params.set("sort", filters.sort);
  }
  // Fetch the whole library (server clamps at 200): client-side title collation
  // (pinyin) AND series grouping both need every row, not just one server page —
  // a series' members could otherwise be split across pages. Fine for a
  // single-user library; revisit if it ever outgrows 200.
  params.set("limit", "200");
  return params.toString();
}

export async function fetchMediaList(
  filters: MediaFilters,
): Promise<MediaListResponse> {
  const qs = buildMediaQueryString(filters);
  const res = await fetch(`/api/media${qs ? `?${qs}` : ""}`);
  if (!res.ok) {
    throw new Error(`Failed to load media (HTTP ${res.status})`);
  }
  return (await res.json()) as MediaListResponse;
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
