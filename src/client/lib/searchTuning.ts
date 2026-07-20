// Shared tuning for every search-as-you-type box that hits an upstream source
// (AniList, Bangumi, TMDB, IGDB). One place, because the add modal and the four
// in-editor pickers had drifted to different delays and all fired on a single
// character — a 1-char query is a wasted round trip whose results are useless,
// and AniList/Bangumi are called from the BROWSER, so those requests count
// against the user's own per-IP rate limit.

/** Quiet period before a typed query is issued. */
export const SEARCH_DEBOUNCE_MS = 500;

/** Shortest Latin-script query worth sending upstream. */
export const MIN_SEARCH_LENGTH = 3;

/**
 * CJK is denser: two characters is a whole title ("死神", "进击"), so holding
 * those to the Latin minimum would break search for exactly the queries this
 * app's Chinese/Japanese sources exist to serve.
 */
export const MIN_SEARCH_LENGTH_CJK = 2;

// Han, hiragana, katakana, and Hangul. A query containing ANY of these counts
// as CJK — mixed input like "Fate 剧场版" is dense enough to search short.
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;

/**
 * Whether a raw input value is worth searching for.
 *
 * Deliberately NOT applied to the library filter box, which searches locally
 * held rows where a 1-2 character prefix is a legitimate filter.
 */
export function isSearchable(query: string): boolean {
  const trimmed = query.trim();
  const min = CJK.test(trimmed) ? MIN_SEARCH_LENGTH_CJK : MIN_SEARCH_LENGTH;
  return trimmed.length >= min;
}
