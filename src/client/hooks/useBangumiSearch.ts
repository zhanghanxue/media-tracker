import { useQuery } from "@tanstack/react-query";

import { searchBangumiBoth } from "../lib/bangumiSearch";
import type { BangumiType } from "../../worker/sources/bangumi";

// Debounced Bangumi search for the manual pickers. Disabled until there's a
// query; keyed on (type, query). Caller debounces `query`.
export function useBangumiSearch(query: string, type: BangumiType) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["bangumi-search", type, trimmed],
    queryFn: () => searchBangumiBoth(trimmed, type),
    enabled: trimmed.length > 0,
  });
}
