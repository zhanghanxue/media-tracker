import { useQuery } from "@tanstack/react-query";

import { isSearchable } from "../lib/searchTuning";
import { searchAniListMedia, type SearchType } from "../lib/api";

// Searches AniList (browser → AniList directly, CORS). Disabled until the query
// is long enough to be worth a round trip; keyed on (type, q) so switching the
// type picker or query refetches. Caller debounces `q`. The query's `signal` is
// forwarded so superseded searches stop burning the user's per-IP rate limit.
export function useAniListSearch(q: string, type: SearchType) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ["anilist-search", type, trimmed],
    queryFn: ({ signal }) => searchAniListMedia(trimmed, type, signal),
    enabled: isSearchable(trimmed),
  });
}
