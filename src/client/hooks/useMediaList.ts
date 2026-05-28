import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { fetchMediaList, type MediaFilters } from "../lib/api";

// Server state for the library list. The filters object is part of the query
// key, so changing any facet or the search term triggers a refetch; cached
// pages stay on screen during the transition (keepPreviousData) to avoid the
// list flashing empty between filter changes.
export function useMediaList(filters: MediaFilters) {
  return useQuery({
    queryKey: ["media", filters],
    queryFn: () => fetchMediaList(filters),
    placeholderData: keepPreviousData,
  });
}
