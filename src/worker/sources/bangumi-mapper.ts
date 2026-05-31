// Pure mapping + matching for the Bangumi integration. Two responsibilities:
//
//   • bangumiToMediaRow — Bangumi subject → insertable `media` row (Option A:
//     add a Chinese title directly from Bangumi, for works AniList lacks).
//   • pickAniListMatch — given Bangumi's native title + AniList search results,
//     decide whether AniList has the SAME work (Option B: resolve to the
//     canonical AniList entry so dedup stays clean). Returns null on no
//     confident match → caller falls back to a Bangumi-direct add.
//
// `title_chinese` is assumed ALREADY Simplified — the browser runs name_cn
// through toSimplified() before this mapper sees it (OpenCC stays client-side).

import type {
  ExternalSource,
  MediaInsert,
  MediaRow,
  MediaStatus,
  MediaType,
} from "../db/schema";
import type { AniListMedia } from "./anilist";
import type { BangumiInfoboxItem, BangumiSubject } from "./bangumi";
import { joinGenres } from "./genres";
import { isoFromString } from "./release-date";
import { ratingFrom10 } from "./rating";

// Same insert shape as the AniList mapper (schema.ts § MediaInsert).
export type BangumiMapperResult = MediaInsert;

// Bangumi tags are free-form Chinese user tags (year, studio, "TV", etc.), so we
// keep only a curated genre whitelist — best-effort, source-native (Chinese).
// Empty is fine: most genre-bearing items resolve to AniList/TMDB instead.
const BANGUMI_GENRE_WHITELIST = new Set([
  "科幻", "奇幻", "魔幻", "悬疑", "推理", "恐怖", "惊悚", "喜剧", "搞笑",
  "恋爱", "爱情", "校园", "青春", "日常", "治愈", "热血", "战斗", "冒险",
  "动作", "历史", "战争", "运动", "竞技", "音乐", "歌舞", "美食", "职场",
  "悬幻", "武侠", "仙侠", "古装", "犯罪", "侦探", "机战", "机甲", "后宫",
  "百合", "耽美", "乙女", "剧情", "家庭", "伦理", "社会", "传记", "奇幻冒险",
]);

/**
 * Best-effort genres for a Bangumi-direct item: its tags ∩ a curated genre
 * whitelist, most-used first. Pure. Returns [] when nothing matches.
 */
export function extractBangumiGenres(subject: BangumiSubject): string[] {
  const tags = (subject.tags ?? [])
    .filter((t) => BANGUMI_GENRE_WHITELIST.has(t.name))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .map((t) => t.name);
  const meta = (subject.meta_tags ?? []).filter((t) =>
    BANGUMI_GENRE_WHITELIST.has(t),
  );
  return [...tags, ...meta];
}

// Bangumi book `platform` values that mean "prose" rather than comics.
const NOVEL_PLATFORMS = new Set(["小说", "輕小說", "轻小说"]);

/**
 * Map a Bangumi subject to a row. `region` defaults to null (unknown): a
 * Bangumi-direct add only happens when AniList lacks the exact entry, which is
 * NOT always Chinese — it also catches Japanese works AniList splits differently
 * (e.g. season parts). Defaulting to "china" mislabeled those, so we leave it
 * unset and let the editor assign it. Callers may still pass an explicit region.
 */
export function bangumiToMediaRow(
  subject: BangumiSubject,
  status: MediaStatus,
  region: MediaRow["region"] = null,
): BangumiMapperResult {
  const type = bangumiToType(subject);

  // Episodic (anime + live-action drama + variety) tracks episodes; books track
  // chapters; films track neither. Bangumi puts the book count in `eps`, falling
  // back to `volumes`; we store it in total_chapters (no separate volume column).
  const tracksEpisodes =
    type === "animation" || type === "drama" || type === "variety";
  const tracksChapters = type === "manga" || type === "light_novel";
  const totalEpisodes = tracksEpisodes
    ? firstPositive(subject.total_episodes, subject.eps)
    : null;
  const totalChapters = tracksChapters
    ? firstPositive(subject.eps, subject.volumes)
    : null;

  const nameCn = subject.name_cn?.trim();

  return {
    type,
    // Caller-supplied region wins; otherwise infer for live-action (type 6),
    // whose platform encodes the country far more reliably than anime.
    region: region ?? regionFromBangumi(subject),
    title_native: subject.name || null,
    title_romaji: null, // Bangumi has no romaji (the Japanese reading) field
    // …but its 别名 (aliases) infobox usually carries the localized ENGLISH title
    // (e.g. "Record of Ragnarok Season 2 Part 1"). Mine it so English-mode
    // display isn't stuck on the native (Japanese/Chinese) name.
    title_english: pickLatinAlias(subject.infobox),
    title_chinese: nameCn ? nameCn : null, // already Simplified (browser-normalized)
    status,
    is_rewatching: 0,
    cover_url: subject.images?.large ?? null, // https lain.bgm.tv URL; re-hosted to R2 by the route
    external_id: String(subject.id),
    external_source: "bangumi" satisfies ExternalSource,
    current_episode: null,
    total_episodes: totalEpisodes,
    current_chapter: null,
    total_chapters: totalChapters,
    runtime_minutes: null, // anime/manga don't track runtime; TMDB-only field.
    release_date: isoFromString(subject.date), // v0 "YYYY-MM-DD" (legacy: air_date)
    source_rating: ratingFrom10(subject.rating?.score), // already 0–10
    genres: joinGenres(extractBangumiGenres(subject)),
    platform: null, // platform is editor-set for Bangumi-direct games
    // Default a Bangumi-direct game to "playing" so its card shows free-text
    // progress (not episode counts); the editor can switch it to watching.
    consumption_mode: type === "game" ? "playing" : null,
    collection_id: null,
    sort_order: null,
  };
}

/**
 * Mine a Latin-script title from a Bangumi subject's 别名 (alias) infobox rows.
 * Returns the first alias that's predominantly Latin letters (so romaji/English
 * aliases qualify but Japanese/Chinese variants don't), or null. Pure.
 */
export function pickLatinAlias(infobox?: BangumiInfoboxItem[]): string | null {
  if (!infobox) return null;

  const candidates: string[] = [];
  for (const item of infobox) {
    if (item.key !== "别名") continue;
    const v = item.value;
    if (typeof v === "string") candidates.push(v);
    else if (Array.isArray(v)) {
      for (const e of v) if (e?.v) candidates.push(e.v);
    }
  }

  for (const raw of candidates) {
    const s = raw.trim();
    const latin = (s.match(/[A-Za-z]/g) ?? []).length;
    const cjk = (s.match(/[぀-ヿ㐀-鿿]/g) ?? []).length;
    if (latin >= 3 && latin > cjk) return s;
  }
  return null;
}

function bangumiToType(subject: BangumiSubject): MediaType {
  if (subject.type === 2) return "animation";
  if (subject.type === 4) return "game";
  if (subject.type === 1) {
    return subject.platform && NOVEL_PLATFORMS.has(subject.platform)
      ? "light_novel"
      : "manga";
  }
  if (subject.type === 6) {
    // Live-action (三次元), discriminated by platform:
    //   综艺 / 真人秀 / 脱口秀 → variety; 电影 / 剧场版 → movie; else (电视剧 /
    //   华语剧 / 日剧 / …) episodic → drama.
    const p = subject.platform ?? "";
    if (/综艺|真人秀|脱口秀/.test(p)) return "variety";
    if (/电影|剧场版/.test(p)) return "movie";
    return "drama";
  }
  // 3 (music), 4 (game) aren't part of this feature.
  throw new Error(`Unsupported Bangumi subject type: ${subject.type}`);
}

/**
 * Best-effort region for a live-action (type 6) subject. Unlike anime — where
 * Bangumi-direct adds catch Japanese works and "china" would mislabel them
 * (hence the null default) — live-action carries reliable country signals, and
 * the user's live-action library is overwhelmingly Chinese-region drama, so
 * seeding a region here saves manual work. Null when non-type-6 or unrecognized
 * → the editor assigns. Two signals, in order:
 *   1. the infobox 国家/地区 (or 地区/产地/制作国家/地区) field — most reliable;
 *      it distinguishes 香港 from 中国大陆 where the generic 华语剧 platform can't
 *      (verified live: 使徒行者 has platform 华语剧 but 国家/地区 = 香港).
 *   2. the `platform` string (华语剧 / 日剧 / …) as a fallback.
 */
function regionFromBangumi(subject: BangumiSubject): MediaRow["region"] {
  if (subject.type !== 6) return null;
  const fromInfobox = regionFromText(
    infoboxText(subject.infobox, ["国家/地区", "地区", "产地", "制作国家/地区"]),
  );
  if (fromInfobox) return fromInfobox;
  return regionFromText(subject.platform ?? "");
}

// Map a country/region label (infobox value or platform) to our region enum by
// substring. Order matters: region-specific labels (香港 / 台湾) are checked
// before the broad 中国 / 大陆 so a HK or TW entry isn't swallowed by "china".
function regionFromText(text: string): MediaRow["region"] {
  if (/香港|港剧/.test(text)) return "hong_kong";
  if (/台湾|臺灣|台剧|台灣/.test(text)) return "taiwan";
  if (/日本|日剧/.test(text)) return "japan";
  if (/韩国|韓國|韩剧|韓/.test(text)) return "korea";
  if (/英国|英國|英剧/.test(text)) return "uk";
  if (/泰国|泰國/.test(text)) return "thailand";
  if (/美国|美國|美剧|欧美/.test(text)) return "usa";
  if (/华语|国产|大陆|内地|中国/.test(text)) return "china";
  return null;
}

// First value of any of the given infobox keys, as plain text (array values —
// e.g. 别名 — are joined). Empty string when none present.
function infoboxText(
  infobox: BangumiInfoboxItem[] | undefined,
  keys: string[],
): string {
  if (!infobox) return "";
  for (const item of infobox) {
    if (!item.key || !keys.includes(item.key)) continue;
    const v = item.value;
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map((e) => e?.v ?? "").join(" ");
  }
  return "";
}

function firstPositive(...values: (number | null | undefined)[]): number | null {
  for (const v of values) {
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
}

/**
 * Does AniList have the same work? Returns the matching AniListMedia (so the
 * caller adds it as the canonical AniList row) or null (no confident match →
 * fall back to a Bangumi-direct add). Match is EXACT *after normalization* of
 * any of the caller's title variants (Bangumi native / Latin alias) against any
 * of the AniList entry's titles (native / romaji / english). Normalization is
 * key: Bangumi writes "終末のワルキューレⅢ" (fullwidth Ⅲ) where AniList has
 * "終末のワルキューレ III" (ASCII) — NFKC + strip collapses both to the same
 * string. Still exact-after-normalize (no prefix), so it won't pick a wrong
 * canonical entry; the UI offers the Bangumi-direct path for what this rejects.
 */
export function pickAniListMatch(
  titleVariants: (string | null | undefined)[],
  results: AniListMedia[],
): AniListMedia | null {
  const targets = titleVariants
    .map((t) => (t ? normalizeTitle(t) : ""))
    .filter((t) => t.length > 0);
  if (targets.length === 0) return null;

  for (const m of results) {
    const candidates = [m.title.native, m.title.romaji, m.title.english]
      .map((x) => (x ? normalizeTitle(x) : ""))
      .filter((x) => x.length > 0);
    if (candidates.some((c) => targets.includes(c))) return m;
  }
  return null;
}

// Normalize a title for fuzzy comparison: NFKC (full-width → half-width),
// lowercase, strip whitespace and common punctuation/symbols. So "NARUTO -ナル
// ト-" and "NARUTO" both collapse toward "naruto…", and the prefix check below
// can relate them. Exported for cross-source library-membership checks.
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]/g, "")
    .replace(/[-–—ー－・·‧･:：;；,，.。!！?？'"`「」『』()（）[\]【】~～_/\\]/g, "");
}

function cleanCn(subject: BangumiSubject): string | null {
  const cn = subject.name_cn?.trim();
  return cn ? cn : null;
}

/**
 * Enricher direction (reverse of pickAniListMatch): given an AniList row's
 * title variants (native / romaji / english) and Bangumi search results,
 * return the Chinese title (raw `name_cn`) of the best-matching subject — or
 * null when none matches confidently. The caller runs the result through
 * toSimplified(); this stays pure (no OpenCC).
 *
 * Matching, against each subject's `name`, in priority order (results come in
 * relevance order, so the first qualifying subject is the most relevant):
 *   1. exact normalized equality with any title variant, then
 *   2. the subject name STARTS WITH a title variant — i.e. Bangumi added a
 *      subtitle to our title ("NARUTO" → "NARUTO -ナルト-").
 *
 * Deliberately NOT the reverse (our title starts with the subject name): that
 * let a short franchise entry ("BLEACH" → 死神) swallow a movie whose title
 * merely begins with the franchise name ("Bleach: Hell Verse"), assigning the
 * series' Chinese title to every movie. Better to leave such a movie unmatched
 * (fill by hand) than label it wrong.
 */
export function pickBangumiChineseTitle(
  titleVariants: (string | null | undefined)[],
  subjects: BangumiSubject[],
): string | null {
  const targets = titleVariants
    .map((t) => (t ? normalizeTitle(t) : ""))
    .filter((t) => t.length > 0);
  if (targets.length === 0) return null;

  for (const s of subjects) {
    const n = normalizeTitle(s.name ?? "");
    if (n && targets.includes(n)) return cleanCn(s);
  }
  for (const s of subjects) {
    const n = normalizeTitle(s.name ?? "");
    if (n && targets.some((t) => n.startsWith(t))) return cleanCn(s);
  }
  return null;
}
