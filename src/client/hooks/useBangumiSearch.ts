import { useQuery } from "@tanstack/react-query";

import { isSearchable } from "../lib/searchTuning";
import { searchBangumiBoth } from "../lib/bangumiSearch";
import type { BangumiType } from "../../worker/sources/bangumi";

// Debounced Bangumi search for the manual pickers. Disabled until the query is
// long enough to be worth a round trip — which for CJK means 2 characters, not
// 3; keyed on (type, query). Caller debounces `query`.
export function useBangumiSearch(query: string, type: BangumiType) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["bangumi-search", type, trimmed],
    queryFn: ({ signal }) => searchBangumiBoth(trimmed, type, signal),
    enabled: isSearchable(trimmed),
  });
}
