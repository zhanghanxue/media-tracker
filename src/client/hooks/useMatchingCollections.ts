import { useQuery } from "@tanstack/react-query";

import { fetchMatchingCollections, type MediaFilters } from "../lib/api";

// While filtering/searching, the set of collection ids whose direct items match
// — so the drill-down can show only collections that actually contain a match
// (then expand to ancestors client-side via the small tree), without loading
// the matching items. Disabled (returns []) when no filter is active.
export function useMatchingCollections(filters: MediaFilters, enabled: boolean) {
  const effective: MediaFilters = { ...filters, q: filters.q.trim() };
  const { data } = useQuery({
    // "media" prefix so item mutations' ["media"] invalidation refreshes matches.
    queryKey: ["media", "matching-collections", effective],
    queryFn: () => fetchMatchingCollections(effective),
    enabled,
  });
  return data ?? [];
}
