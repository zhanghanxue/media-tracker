// Thin fetch wrapper for the media API. Returns parsed JSON or throws on a
// non-2xx (React Query turns the throw into `error` state).

import type { AniListMedia } from "../../worker/sources/anilist";
import type { MediaStatus, MediaType } from "../../worker/db/schema";
import type { MediaListResponse, MediaRow } from "./types";

export interface MediaFilters {
  types: string[];
  regions: string[];
  statuses: string[];
  q: string;
}

export function buildMediaQueryString(filters: MediaFilters): string {
  const params = new URLSearchParams();
  for (const t of filters.types) params.append("type", t);
  for (const r of filters.regions) params.append("region", r);
  for (const s of filters.statuses) params.append("status", s);
  const q = filters.q.trim();
  if (q) params.set("q", q);
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

// --- AniList search + add (Phase 8) ---------------------------------------

export type SearchType = "ANIME" | "MANGA";

export type AniListSearchItem = AniListMedia & { alreadyAdded: boolean };

export interface AniListSearchResponse {
  results: AniListSearchItem[];
}

export async function searchAniListMedia(
  q: string,
  type: SearchType,
): Promise<AniListSearchResponse> {
  const params = new URLSearchParams({ q, type });
  const res = await fetch(`/api/anilist/search?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`AniList search failed (HTTP ${res.status})`);
  }
  return (await res.json()) as AniListSearchResponse;
}

export interface AddMediaInput {
  external_source: "anilist";
  external_id: number;
  type: MediaType;
  status: MediaStatus;
}

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
