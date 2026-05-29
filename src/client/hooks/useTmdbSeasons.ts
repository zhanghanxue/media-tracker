import { useQuery } from "@tanstack/react-query";

import { fetchTmdbSeasons } from "../lib/tmdbSearch";

// Fetches a TMDB tv show's seasons, lazily — disabled until `showId` is non-null
// (the Add modal only fetches when the user expands a show's season list).
export function useTmdbSeasons(showId: number | null) {
  return useQuery({
    queryKey: ["tmdb-seasons", showId],
    queryFn: () => fetchTmdbSeasons(showId!),
    enabled: showId != null,
    staleTime: 5 * 60_000,
  });
}
