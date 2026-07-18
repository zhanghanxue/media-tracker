// Precomputed pinyin sort key for the zh title sort (title_zh / title_zh_desc).
// SQLite can only code-point-order CJK (火 U+706B > 死 U+6B7B, so it would put
// 死神 before 火影忍者 — backwards for pinyin), and the list is server-PAGINATED,
// so the correct pinyin order can't be reconstructed client-side. We store a
// romanized key at insert/edit time and let the server ORDER BY it.
//
// The zh-display title mirrors media-query-builder's title_zh COALESCE
// (title_chinese > title_native > title_english > title_romaji). The client
// computes the SAME transform for collection-card interleave — keep them in
// sync (src/client/lib/pinyinSort.ts).

import { pinyin } from "pinyin-pro";

import type { MediaPatch } from "../api/patch-media";
import type { MediaRow } from "../db/schema";

export interface SortTitleFields {
  title_chinese: string | null;
  title_native: string | null;
  title_english: string | null;
  title_romaji: string | null;
}

/** The zh-display title an item sorts by — same fallback order as the server's
 *  title_zh COALESCE. */
export function zhSortTitle(t: SortTitleFields): string {
  return t.title_chinese || t.title_native || t.title_english || t.title_romaji || "";
}

/** Toneless pinyin of `text`, non-Chinese runs kept as-is, lowercased — so
 *  `ORDER BY key COLLATE NOCASE` sorts Chinese by pinyin (火影 < 死神) and Latin
 *  titles lexically. Empty string in → empty string out. */
export function toPinyinKey(text: string): string {
  if (!text) return "";
  return pinyin(text, {
    toneType: "none",
    nonZh: "consecutive",
    type: "string",
  }).toLowerCase();
}

/** The stored title_sort_zh value for a row: pinyin of its zh-display title. */
export function titleSortZh(t: SortTitleFields): string {
  return toPinyinKey(zhSortTitle(t));
}

const TITLE_FIELDS = [
  "title_chinese",
  "title_native",
  "title_english",
  "title_romaji",
] as const;

/**
 * If `patch` changes any title field, add the recomputed pinyin sort key so the
 * stored key never drifts from the titles. Computed from the MERGED row (the
 * existing row overlaid with the patch — what the row is about to become). A
 * no-op patch that touches no title returns unchanged.
 */
export function withTitleSortKey(
  existing: MediaRow,
  patch: MediaPatch,
): MediaPatch {
  if (!TITLE_FIELDS.some((f) => f in patch)) return patch;
  return { ...patch, title_sort_zh: titleSortZh({ ...existing, ...patch }) };
}
