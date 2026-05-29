import { useQuery } from "@tanstack/react-query";

import { normalizeTitle } from "../../worker/sources/bangumi-mapper";
import type { MediaListResponse } from "../lib/types";

// A normalized-title index of the WHOLE library, used to flag search results
// (AniList or Bangumi) that are already in the library — even when they were
// added under a different source. This is the cross-source dedup hint: an item
// added via Chinese/Bangumi (bangumi id) still shows "in library" when found
// again via AniList search, and vice versa, because we match on title rather
// than on a source-specific id.
//
// Distinct seasons have distinct titles ("…Ⅱ" vs "…Ⅲ"), so this won't conflate
// them; the only false-positive risk is two genuinely different works sharing a
// title, which is rare and only affects a hint.
export function useLibraryTitleIndex(): Set<string> {
  const { data } = useQuery({
    // Under the "media" prefix so add/delete/enrich invalidations refresh it.
    queryKey: ["media", "titles-index"],
    queryFn: async (): Promise<Set<string>> => {
      const res = await fetch("/api/media?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { items } = (await res.json()) as MediaListResponse;
      const set = new Set<string>();
      for (const row of items) {
        for (const title of [
          row.title_native,
          row.title_romaji,
          row.title_english,
          row.title_chinese,
        ]) {
          const n = title ? normalizeTitle(title) : "";
          if (n) set.add(n);
        }
      }
      return set;
    },
    staleTime: 30_000,
  });
  return data ?? new Set();
}

/** True if any of the candidate titles is already represented in the library. */
export function titleInLibrary(
  index: Set<string>,
  titles: (string | null | undefined)[],
): boolean {
  return titles.some((t) => {
    const n = t ? normalizeTitle(t) : "";
    return n.length > 0 && index.has(n);
  });
}
