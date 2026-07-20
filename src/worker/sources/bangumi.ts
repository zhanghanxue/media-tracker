// Bangumi (bgm.tv) client. Operations:
//   • searchBangumiV0     — POST /v0/search/subjects (good relevance; works for
//       Latin/romaji queries, returns 0 for CJK keywords)
//   • searchBangumiLegacy — GET /search/subject/{keywords} (handles Japanese
//       kanji + Chinese keywords, but flaky and poorly-ranked for Latin)
//   • getBangumiSubject   — GET /v0/subjects/{id} (full detail for an add)
//
// The two search endpoints are COMPLEMENTARY (learned by probing, 2026-05-29):
// v0 indexes romaji/aliases and ranks the main title first, but returns nothing
// for kanji/Chinese; legacy is the opposite. Callers query v0 by romaji/English
// first and fall back to legacy by the native (kanji) title.
//
// Like the AniList client, this is ISOMORPHIC and runs in the BROWSER: Bangumi
// sends permissive CORS (`Access-Control-Allow-Origin: *`, and the v0 POST
// preflight is allowed) and needs no auth for reads, so the client calls it
// directly (sidestepping the Worker-egress-block class of problem from Phase 11).
//
// Bangumi's `name_cn` may be Traditional Chinese for some entries; callers must
// run it through `toSimplified` (browser, OpenCC) before persisting — see
// src/client/lib/toSimplified.ts.

const BANGUMI_BASE = "https://api.bgm.tv";

// Subject types we support. 1 = book (manga / light novel), 2 = anime / donghua,
// 4 = game (the CJK-search fallback for Chinese games IGDB lacks or that are hard
// to recognize under English names), 6 = real / 三次元 (live-action → drama /
// movie / variety). 3 (music) remains out of scope.
export type BangumiType = 1 | 2 | 4 | 6;

export interface BangumiImages {
  large: string | null;
  common: string | null;
  medium: string | null;
  small: string | null;
  grid: string | null;
}

// The subset of Bangumi's subject shape we rely on. The three endpoints return
// slightly different shapes: legacy search + v0 detail use `images` (an object);
// v0 search uses `image` (a single string). All carry id/type/name/name_cn.
export interface BangumiSubject {
  id: number;
  type: number;
  name: string; // original title (Japanese for anime, Chinese for donghua, …)
  name_cn: string; // Chinese title — MAY be Traditional; normalize before persisting
  platform?: string | null; // "TV" | "WEB" | "OVA" | "剧场版" | "漫画" | "小说" | …
  eps?: number | null;
  total_episodes?: number | null;
  volumes?: number | null;
  date?: string | null;
  images?: BangumiImages | null; // legacy search + v0 detail
  image?: string | null; // v0 search (single URL)
  infobox?: BangumiInfoboxItem[]; // v0 detail only — holds 别名 (aliases)
  // v0 detail only. `tags` are user tags (name + count, noisy); `meta_tags` are
  // a curated subset. The mapper keeps only the ones in a genre whitelist.
  tags?: BangumiTag[];
  meta_tags?: string[];
  // v0 detail: aggregate community rating. `score` is 0–10 (0 / absent =
  // unrated). Normalized to `source_rating` by the mapper.
  rating?: { score?: number | null } | null;
}

export interface BangumiTag {
  name: string;
  count?: number;
}

// A v0 subject-detail infobox row. `value` is either a plain string or a list
// of `{ v }` entries (e.g. 别名 / aliases). We mine it for a Latin-script title.
export interface BangumiInfoboxItem {
  key?: string;
  value?: string | Array<{ v?: string }>;
}

export interface BangumiClientOptions {
  /** Override fetch (used in tests). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /**
   * Abort the in-flight request. Search-as-you-type supersedes its own requests
   * constantly; without this every superseded request stays open.
   */
  signal?: AbortSignal;
}

export class BangumiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BangumiError";
  }
}

/**
 * v0 search (POST /v0/search/subjects). Best relevance — the main title ranks
 * first — and it indexes romaji/aliases, so a romaji query like "Kimetsu no
 * Yaiba" finds the kanji-named subject. BUT it returns 0 for CJK keywords, so
 * callers query it with romaji/English and fall back to the legacy endpoint for
 * kanji. Returns [] on no match.
 */
export async function searchBangumiV0(
  keyword: string,
  type: BangumiType,
  options: BangumiClientOptions & { max?: number } = {},
): Promise<BangumiSubject[]> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const max = options.max ?? 25;

  const response = await fetchImpl(
    `${BANGUMI_BASE}/v0/search/subjects?limit=${max}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ keyword, filter: { type: [type] } }),
      signal: options.signal,
    },
  );

  if (response.status === 404) return [];
  if (!response.ok) {
    throw new BangumiError(`Bangumi v0 search failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data?: BangumiSubject[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

/**
 * Legacy fuzzy search (GET /search/subject/{keywords}). Handles Japanese kanji
 * and Chinese keywords (v0 can't), but is flaky and ranks side-products above
 * the main series, so it's the FALLBACK, queried by the native title. Returns []
 * for a no-match (Bangumi answers with either `{results:0}` or a 404 body, both
 * meaning "nothing found", not "request failed").
 */
export async function searchBangumiLegacy(
  keyword: string,
  type: BangumiType,
  options: BangumiClientOptions & { max?: number } = {},
): Promise<BangumiSubject[]> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const max = options.max ?? 25;
  const url =
    `${BANGUMI_BASE}/search/subject/${encodeURIComponent(keyword)}` +
    `?type=${type}&responseGroup=large&max_results=${max}`;

  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    signal: options.signal,
  });

  // A 404 here means "no subjects matched" — Bangumi's legacy quirk. Treat as
  // an empty result set, not an error.
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new BangumiError(`Bangumi search failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as
    | { list?: BangumiSubject[]; results?: number }
    | { code: number; error: string };

  // Some no-match responses come back 200 with an error-shaped body.
  if ("code" in payload || !("list" in payload) || !Array.isArray(payload.list)) {
    return [];
  }
  return payload.list;
}

/**
 * Full subject detail by id — the source for a Bangumi-direct add (Option A).
 * Returns null when the id doesn't exist (404).
 */
export async function getBangumiSubject(
  id: number,
  options: BangumiClientOptions = {},
): Promise<BangumiSubject | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const response = await fetchImpl(`${BANGUMI_BASE}/v0/subjects/${id}`, {
    headers: { Accept: "application/json" },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new BangumiError(`Bangumi subject fetch failed: HTTP ${response.status}`);
  }

  return (await response.json()) as BangumiSubject;
}
