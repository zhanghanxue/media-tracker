// Title ordering for a drill-down level. The grid interleaves collection cards
// among the server-PAGINATED items (useLevelItems, LEVEL_PAGE_SIZE per page), so
// the client's item order MUST match the server's ORDER BY — otherwise an item
// that belongs on a later page gets collated above ones already shown, and the
// sort is wrong across page boundaries (and "Load more" inserts rows mid-list).
//
// The server paginates title sorts by
//   COALESCE(title_english, title_romaji, title_native, title_chinese) COLLATE NOCASE
// (see media-query-builder.ts SORT_CLAUSES.title). We mirror that exactly here.
// Ordering by the DISPLAY title instead (pinyin for zh) can't be page-correct
// under pagination — that would need a precomputed server-side sort key.

import type { MediaRow } from "./types";

/**
 * The key an item is ordered by at a level — mirrors the server's title
 * COALESCE, lowercased to mirror COLLATE NOCASE (ASCII case-fold). Empty string
 * when a row has no title at all (sorts first, matching COALESCE(... ) = '').
 */
export function levelTitleKey(item: MediaRow): string {
  return (
    item.title_english ||
    item.title_romaji ||
    item.title_native ||
    item.title_chinese ||
    ""
  ).toLowerCase();
}

/**
 * Compare two pre-lowercased title keys the way SQLite `COLLATE NOCASE` does
 * among the paginated items: by code point, and crucially NON-numeric — so
 * "part 10" sorts before "part 2" exactly as the server paginates them (an
 * Intl.Collator with numeric:true would disagree and reshuffle across pages).
 * Returns <0 / 0 / >0.
 */
export function compareTitleKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
