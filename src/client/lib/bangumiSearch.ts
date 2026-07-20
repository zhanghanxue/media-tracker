// Shared Bangumi search for the manual pickers (editor Chinese-title picker and
// the add-by-Chinese flow). Queries BOTH endpoints and merges, because the two
// are complementary and the user might type in any script:
//   • v0      — great relevance for Latin/romaji input, returns 0 for CJK
//   • legacy  — handles Japanese kanji AND Chinese input
// So a query like "death note", "デスノート", or "死神" all find results.

import {
  searchBangumiLegacy,
  searchBangumiV0,
  type BangumiSubject,
  type BangumiType,
} from "../../worker/sources/bangumi";
import type { MediaType } from "../../worker/db/schema";

/** Map a library row's type to the Bangumi subject type to search. */
export function bangumiTypeFor(mediaType: MediaType): BangumiType {
  if (mediaType === "manga" || mediaType === "light_novel") return 1; // book
  if (mediaType === "game") return 4; // game
  if (mediaType === "drama" || mediaType === "movie" || mediaType === "variety")
    return 6; // live-action
  return 2; // animation
}

/** Best cover URL across the two response shapes (v0 `image` vs legacy
 * `images`), upgraded to https — legacy returns http://lain.bgm.tv URLs that a
 * https page would block as mixed content. */
export function bangumiCover(subject: BangumiSubject): string | null {
  const url =
    subject.images?.large ?? subject.images?.common ?? subject.image ?? null;
  return url ? url.replace(/^http:\/\//, "https://") : null;
}

/**
 * Search both endpoints and merge, v0 first (better ranked), deduped by id.
 * Neither endpoint failing sinks the search — whichever returns, returns.
 */
export async function searchBangumiBoth(
  query: string,
  type: BangumiType,
  signal?: AbortSignal,
): Promise<BangumiSubject[]> {
  const [v0, legacy] = await Promise.allSettled([
    searchBangumiV0(query, type, { max: 12, signal }),
    searchBangumiLegacy(query, type, { max: 12, signal }),
  ]);

  const lists = [
    v0.status === "fulfilled" ? v0.value : [],
    legacy.status === "fulfilled" ? legacy.value : [],
  ];

  const seen = new Set<number>();
  const merged: BangumiSubject[] = [];
  for (const list of lists) {
    for (const s of list) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        merged.push(s);
      }
    }
  }
  return merged;
}
