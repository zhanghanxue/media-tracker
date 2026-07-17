// Shared genre normalization + storage encoding, used by every source mapper
// and the backfill script.
//
// Storage format (migration 0004): a SENTINEL-DELIMITED string `|A|B|C|`. The
// leading/trailing `|` lets `genres LIKE '%|RPG|%'` match the whole token
// exactly — without the sentinels a search for "RPG" could false-match a genre
// whose name merely contains "RPG". NULL when there are no genres.
//
// Genres are stored under ONE canonical name per concept, in CHINESE (user
// decision, 2026-07): the library mixes Bangumi (Chinese genre names) with
// AniList/IGDB/TMDB (English), and without canonicalization the filter facets
// showed "Action" and "动作" side by side as different genres. Bangumi's names
// are already canonical; English names translate through CANONICAL_ZH below.
// English names with no established / whitelist Chinese counterpart (MOBA, 4X,
// Ecchi, …) pass through unchanged — a mixed leftover beats a made-up label.
// Migration 0011 rewrote pre-existing rows to match.

const SENTINEL = "|";

// Per-name cleanup. Keyed by the raw source name; only the obvious offenders.
// IGDB labels its RPG genre "Role-playing (RPG)" — the parenthetical is what
// people actually filter on, so collapse it to the short form. Runs BEFORE
// CANONICAL_ZH, so the Chinese map only needs the cleaned-up form.
const CLEANUP: Record<string, string> = {
  "Role-playing (RPG)": "RPG",
  "Turn-based strategy (TBS)": "Strategy",
  "Real Time Strategy (RTS)": "Strategy",
  "Hack and slash/Beat 'em up": "Hack and slash",
  "Science Fiction": "Sci-Fi", // TMDB
  "Science fiction": "Sci-Fi", // IGDB theme (lowercase f)
};

// Canonical Chinese name per English genre (keyed by the post-CLEANUP form).
// Targets reuse the Bangumi genre whitelist's terms wherever one exists
// (bangumi-mapper.ts § BANGUMI_GENRE_WHITELIST) so both sources converge on
// the same token.
const CANONICAL_ZH: Record<string, string> = {
  // Shared across AniList / IGDB / TMDB
  Action: "动作",
  Adventure: "冒险",
  Comedy: "喜剧",
  Drama: "剧情",
  Fantasy: "奇幻",
  Horror: "恐怖",
  Mystery: "悬疑",
  Romance: "爱情",
  "Sci-Fi": "科幻",
  Thriller: "惊悚",
  Music: "音乐",
  Crime: "犯罪",
  History: "历史",
  Historical: "历史",
  War: "战争",
  Warfare: "战争",
  "War & Politics": "战争",
  Family: "家庭",
  Documentary: "纪录片",
  Western: "西部",
  Animation: "动画",
  Biography: "传记",
  // AniList (anime / manga)
  "Slice of Life": "日常",
  Sports: "运动",
  Sport: "运动",
  Supernatural: "超自然",
  Psychological: "心理",
  Mecha: "机甲",
  "Mahou Shoujo": "魔法少女",
  // IGDB genres (games)
  RPG: "角色扮演",
  Shooter: "射击",
  Fighting: "格斗",
  Platform: "平台跳跃",
  Puzzle: "解谜",
  Racing: "竞速",
  Simulator: "模拟",
  Strategy: "策略",
  Tactical: "战术",
  Arcade: "街机",
  "Visual Novel": "视觉小说",
  Indie: "独立",
  "Hack and slash": "砍杀",
  "Point-and-click": "点击冒险",
  // IGDB themes
  Survival: "生存",
  Stealth: "潜行",
  Sandbox: "沙盒",
  "Open world": "开放世界",
  // TMDB TV
  "Action & Adventure": "动作冒险",
  "Sci-Fi & Fantasy": "科幻奇幻",
  Reality: "真人秀",
  Talk: "脱口秀",
  Kids: "儿童",
  Soap: "肥皂剧",
};

/**
 * Normalize a single raw genre name: trim, apply the cleanup map, then the
 * canonical-Chinese map. Unmapped names pass through as-is.
 */
export function cleanupGenre(raw: string): string {
  const name = raw.trim();
  const cleaned = CLEANUP[name] ?? name;
  return CANONICAL_ZH[cleaned] ?? cleaned;
}

/**
 * Clean a list of raw genre names → de-duplicated, sentinel-free, order-preserving.
 * Drops anything blank or containing the sentinel (defensive: a genre name with
 * a literal `|` would corrupt the encoding).
 */
export function normalizeGenres(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const g = cleanupGenre(r);
    if (!g || g.includes(SENTINEL) || seen.has(g)) continue;
    seen.add(g);
    out.push(g);
  }
  return out;
}

/**
 * Encode genres for storage: `|A|B|` (sentinel-wrapped), or NULL when empty.
 * Applies normalizeGenres first, so callers can pass raw source names directly.
 */
export function joinGenres(raw: readonly string[]): string | null {
  const list = normalizeGenres(raw);
  if (list.length === 0) return null;
  return SENTINEL + list.join(SENTINEL) + SENTINEL;
}

/** Decode a stored `|A|B|` string back to display names (for facet tallying). */
export function splitGenres(stored: string | null): string[] {
  if (!stored) return [];
  return stored.split(SENTINEL).filter(Boolean);
}

/**
 * The `LIKE` pattern that matches rows whose genre set contains `genre`.
 * Escapes LIKE wildcards in the genre name so it's used with `ESCAPE '\'`
 * (consistent with the title search) and matches the token literally.
 */
export function genreLikePattern(genre: string): string {
  const escaped = genre.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${SENTINEL}${escaped}${SENTINEL}%`;
}
