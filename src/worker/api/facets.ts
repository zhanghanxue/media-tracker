// Pure helper for the dynamic genre facet (GET /api/media/facets). Given the raw
// `genres` column values of the in-scope rows (each a sentinel-delimited string
// or null), tally how many rows carry each distinct genre, most-common first.
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
