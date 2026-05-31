import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";

import {
  fetchMediaPage,
  LEVEL_PAGE_SIZE,
  type MediaFilters,
} from "../lib/api";

// Paginated items for ONE drill-down level (a collection's direct items, or the
// loose items at root via COLLECTION_ROOT). Offset pages of LEVEL_PAGE_SIZE so
// the Worker never serializes more than a page at a time — this is the change
// that keeps the list request off the Worker CPU ceiling as the library grows.
//
// `scope` is the collection id (or COLLECTION_ROOT). The active facet/search
// filters + sort still apply server-side, so a filtered drill-down narrows the
// level's items too.
export function useLevelItems(filters: MediaFilters, scope: string) {
  const scoped: MediaFilters = { ...filters, q: filters.q.trim(), collection: scope };

  return useInfiniteQuery({
    // "media" prefix so item mutations' ["media"] invalidation refreshes levels.
    queryKey: ["media", "level", scoped],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchMediaPage(scoped, { limit: LEVEL_PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
}
