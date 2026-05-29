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

// Same insert shape as the AniList mapper (schema.ts § MediaInsert).
export type BangumiMapperResult = MediaInsert;

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

  const isAnime = type === "animation";
  const totalEpisodes = isAnime ? firstPositive(subject.total_episodes, subject.eps) : null;
  // Books track by chapter/volume; Bangumi puts the count in `eps`, falling back
  // to `volumes`. We store it in total_chapters (no separate volume column).
  const totalChapters = isAnime ? null : firstPositive(subject.eps, subject.volumes);

  const nameCn = subject.name_cn?.trim();

  return {
    type,
    region,
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
    series_id: null,
    series_name: null,
    season_number: null,
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
  if (subject.type === 1) {
    return subject.platform && NOVEL_PLATFORMS.has(subject.platform)
      ? "light_novel"
      : "manga";
  }
  // 3 (music), 4 (game), 6 (real) aren't part of the Chinese-title feature.
  throw new Error(`Unsupported Bangumi subject type: ${subject.type}`);
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
    .replace(/[-–—ー－・:：;；,，.。!！?？'"`「」『』()（）[\]【】~～_/\\]/g, "");
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
