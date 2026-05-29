import { useQuery } from "@tanstack/react-query";

import { searchIgdbMedia } from "../lib/igdbSearch";

// Debounced IGDB search via the Worker proxy. Disabled until there's a query;
// keyed on the trimmed query. Caller debounces.
export function useIgdbSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["igdb-search", trimmed],
    queryFn: () => searchIgdbMedia(trimmed),
    enabled: trimmed.length > 0,
  });
}
