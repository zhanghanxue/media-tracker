// Pure helpers for the dynamic facets (GET /api/media/facets). Given raw
// column values of the in-scope rows, tally how many rows carry each distinct
// value, most-common first: genres (sentinel-delimited strings) and regions
// (plain open-ended slugs — the sidebar merges these with the curated set so
// free-text "Other…" regions still show up as filter options).
// Pure → unit-tested in the node project; the route supplies the rows.

import { splitGenres } from "../sources/genres";

export interface GenreFacet {
  value: string;
  count: number;
}

/**
 * Tally distinct genres across the given stored `genres` column values.
 * Sorted by count desc, then name asc (stable, readable order for the UI).
 */
export function tallyGenres(storedColumns: (string | null)[]): GenreFacet[] {
  const counts = new Map<string, number>();
  for (const stored of storedColumns) {
    for (const g of splitGenres(stored)) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * Tally distinct region values across the given `region` column values.
 * NULL / empty (region unset) is ignored — the sidebar's `__unset__` sentinel
 * covers that bucket. Same ordering as the genre tally.
 */
export function tallyRegions(regionColumns: (string | null)[]): GenreFacet[] {
  const counts = new Map<string, number>();
  for (const region of regionColumns) {
    if (!region) continue;
    counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
