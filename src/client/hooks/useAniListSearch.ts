import { useQuery } from "@tanstack/react-query";

import { searchAniListMedia, type SearchType } from "../lib/api";

// Searches AniList via the Worker proxy. Disabled (no request) until there's a
// non-empty query; keyed on (type, q) so switching the type picker or query
// refetches. Caller is responsible for debouncing `q`.
export function useAniListSearch(q: string, type: SearchType) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ["anilist-search", type, trimmed],
    queryFn: () => searchAniListMedia(trimmed, type),
    enabled: trimmed.length > 0,
  });
}
