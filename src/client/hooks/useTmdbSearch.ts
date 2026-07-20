import { useQuery } from "@tanstack/react-query";

import { isSearchable } from "../lib/searchTuning";
import { searchTmdbMedia } from "../lib/tmdbSearch";
import type { TmdbKind } from "../../worker/sources/tmdb";

// Searches TMDB via the Worker proxy (key-bearing → server-side). Disabled until
// the query is long enough to be worth a round trip; keyed on (kind, q). Caller
// debounces `q`. The query's `signal` is forwarded so a superseded search is
// actually cancelled rather than left running to completion.
export function useTmdbSearch(query: string, kind: TmdbKind) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["tmdb-search", kind, trimmed],
    queryFn: ({ signal }) => searchTmdbMedia(trimmed, kind, signal),
    enabled: isSearchable(trimmed),
  });
}
