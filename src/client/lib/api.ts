// Thin fetch wrapper for the media API. Returns parsed JSON or throws on a
// non-2xx (React Query turns the throw into `error` state).

import type { MediaListResponse } from "./types";

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
