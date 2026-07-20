import { useQuery } from "@tanstack/react-query";

import { isSearchable } from "../lib/searchTuning";
import { searchIgdbMedia } from "../lib/igdbSearch";

// Debounced IGDB search via the Worker proxy. Disabled until the query is long
// enough to be worth a round trip; keyed on the trimmed query. Caller debounces.
export function useIgdbSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["igdb-search", trimmed],
    queryFn: ({ signal }) => searchIgdbMedia(trimmed, signal),
    enabled: isSearchable(trimmed),
  });
}
