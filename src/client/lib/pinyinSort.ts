// Client half of the pinyin title sort (issue #3). The server ORDER BYs a stored
// pinyin key (title_sort_zh) so paginated ITEMS come back in pinyin order; the
// grid interleaves collection cards among them and so must key BOTH items and
// collections by the same pinyin transform. pinyin-pro is dynamic-imported (like
// opencc-js) so it stays out of the main bundle.
//
// The transform here MUST match the worker's toPinyinKey (sources/titleSortKey.ts):
// toneless pinyin, non-Chinese runs kept, lowercased — otherwise a collection
// card would slot at the wrong spot among the server-ordered items.

import type { SortKey } from "./api";
import type { MediaRow, UiLang } from "./types";

/** zh-display title precedence — mirrors the worker's zhSortTitle and the server
 *  title_zh COALESCE(title_chinese, title_native, title_english, title_romaji). */
export function zhSortTitle(
  item: Pick<
    MediaRow,
    "title_chinese" | "title_native" | "title_english" | "title_romaji"
  >,
): string {
  return (
    item.title_chinese ||
    item.title_native ||
    item.title_english ||
    item.title_romaji ||
    ""
  );
}

/** Map the single "Title A–Z / Z–A" dropdown value to the language-appropriate
 *  server sort key: a zh UI sorts by the pinyin-keyed title_zh; en keeps the
 *  English-first `title`. Non-title sorts pass through unchanged. */
export function resolveTitleSort(sort: SortKey, lang: UiLang): SortKey {
  if (lang !== "zh") return sort;
  if (sort === "title") return "title_zh";
  if (sort === "title_desc") return "title_zh_desc";
  return sort;
}

// --- Lazy pinyin (dynamic import, mirrors the worker transform) --------------

let pinyinFn: ((text: string) => string) | null = null;
let loading: Promise<void> | null = null;

/** Kick off (once) the dynamic import of pinyin-pro. */
export function loadPinyin(): Promise<void> {
  if (pinyinFn) return Promise.resolve();
  if (!loading) {
    loading = import("pinyin-pro").then((m) => {
      pinyinFn = (text) =>
        text
          ? m
              .pinyin(text, {
                toneType: "none",
                nonZh: "consecutive",
                type: "string",
              })
              .toLowerCase()
          : "";
    });
  }
  return loading;
}

/** True once pinyin-pro has loaded and pinyinKey returns real pinyin. */
export function isPinyinReady(): boolean {
  return pinyinFn !== null;
}

/** Pinyin sort key for `text`. Before pinyin-pro loads, falls back to a plain
 *  lowercase (a brief, self-correcting first paint) — gate real use on
 *  isPinyinReady()/usePinyinReady so the grid re-renders once it's ready. */
export function pinyinKey(text: string): string {
  return pinyinFn ? pinyinFn(text) : text.toLowerCase();
}
