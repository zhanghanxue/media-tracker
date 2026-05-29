import { useQuery } from "@tanstack/react-query";

import { searchTmdbMedia } from "../lib/tmdbSearch";
import type { TmdbKind } from "../../worker/sources/tmdb";

// Searches TMDB via the Worker proxy (key-bearing → server-side). Disabled until
// there's a non-empty query; keyed on (kind, q). Caller debounces `q`.
export function useTmdbSearch(query: string, kind: TmdbKind) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["tmdb-search", kind, trimmed],
    queryFn: () => searchTmdbMedia(trimmed, kind),
    enabled: trimmed.length > 0,
  });
}
