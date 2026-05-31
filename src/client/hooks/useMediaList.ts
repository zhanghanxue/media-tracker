import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fetchMediaList, type MediaFilters } from "../lib/api";
import { compareByDisplayTitle, uiLangFromI18n } from "../lib/displayTitle";

// Server state for the library list. The (effective) filters object + language
// are part of the query key, so changing any facet, the search term, the sort,
// or the UI language triggers a refetch; cached pages stay on screen during the
// transition (keepPreviousData) to avoid the list flashing empty.
//
// "Title A–Z" sorting runs CLIENT-SIDE: SQLite can only code-point-order CJK
// (which gets pinyin backwards — 死神 before 火影忍者), so we let the server
// return a generous window (buildMediaQueryString bumps the limit for title
// sorts) and re-sort it here with locale collation (pinyin for zh). Date sorts
// stay server-side.
export function useMediaList(filters: MediaFilters) {
  const { i18n } = useTranslation();
  const lang = uiLangFromI18n(i18n.language);
  const isTitleSort = filters.sort === "title";

  // Normalize the search term BEFORE it becomes part of the query key. The server
  // trims `q`, so "加速世界" and "加速世界 " hit the same SQL — but if the raw
  // (untrimmed) value were in the key, the trailing space would spawn a second
  // cache entry and a redundant refetch whose in-flight (keepPreviousData) state
  // looks like a different result count. Trimming the key collapses them to one.
  const effective: MediaFilters = { ...filters, q: filters.q.trim() };

  return useQuery({
    queryKey: ["media", effective, isTitleSort ? lang : null],
    queryFn: () => fetchMediaList(effective),
    placeholderData: keepPreviousData,
    select: isTitleSort
      ? (data) => ({
          ...data,
          items: [...data.items].sort((a, b) =>
            compareByDisplayTitle(a, b, lang),
          ),
        })
      : undefined,
  });
}
