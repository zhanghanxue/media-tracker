// Chinese-title enrichment (Option B / backfill): for an AniList row with no
// title_chinese, look the work up on Bangumi by its native (Japanese) title and
// take the matching Simplified Chinese title. Runs entirely in the browser —
// Bangumi is browser-direct (CORS), and OpenCC (toSimplified) is client-only.
//
// Used by both the one-shot backfill button (useEnrichChineseTitles) and the
// add-time auto-fill (useAddMedia).

import { searchAniList } from "../../worker/sources/anilist";
import {
  getBangumiSubject,
  searchBangumiLegacy,
  searchBangumiV0,
  type BangumiSubject,
  type BangumiType,
} from "../../worker/sources/bangumi";
import {
  pickAniListMatch,
  pickBangumiChineseTitle,
  pickLatinAlias,
} from "../../worker/sources/bangumi-mapper";
import { toSimplified } from "./toSimplified";
import type { MediaRow } from "./types";

export interface LatinTitlePatch {
  title_romaji?: string | null;
  title_english?: string | null;
}

// AniList types we can enrich, mapped to the Bangumi subject type to search.
const TYPE_TO_BANGUMI: Partial<Record<MediaRow["type"], BangumiType>> = {
  animation: 2,
  manga: 1,
  light_novel: 1,
};

/**
 * Rows worth enriching: AniList-sourced, no Chinese title yet, an enrichable
 * type, and a native title to search by. (Bangumi-direct rows already have
 * their Chinese title; donghua without one are best fixed by hand.)
 */
export function needsChineseTitle(row: MediaRow): boolean {
  return (
    row.external_source === "anilist" &&
    !row.title_chinese &&
    !!row.title_native &&
    row.type in TYPE_TO_BANGUMI
  );
}

/**
 * Look up a Simplified Chinese title for one row via Bangumi. Returns null when
 * no confident match is found — caller leaves the row as-is. Throws only on a
 * hard error (individual attempts that error are skipped).
 *
 * Strategy (the two Bangumi search endpoints are complementary): query v0 by
 * romaji/English first — it ranks the main title first and handles Latin
 * queries (incl. romaji of Japanese works) — then fall back to the legacy
 * endpoint by the native (kanji) title, which v0 can't search. Each result set
 * is matched against ALL the row's title variants (normalized + prefix).
 */
export async function lookupChineseTitle(row: MediaRow): Promise<string | null> {
  const bgmType = TYPE_TO_BANGUMI[row.type];
  if (!bgmType) return null;

  const variants = [row.title_native, row.title_romaji, row.title_english];

  const attempts: Array<() => Promise<BangumiSubject[]>> = [];
  if (row.title_romaji) {
    attempts.push(() => searchBangumiV0(row.title_romaji!, bgmType, { max: 25 }));
  }
  if (row.title_english && row.title_english !== row.title_romaji) {
    attempts.push(() => searchBangumiV0(row.title_english!, bgmType, { max: 25 }));
  }
  if (row.title_native) {
    attempts.push(() =>
      searchBangumiLegacy(row.title_native!, bgmType, { max: 25 }),
    );
  }

  for (const attempt of attempts) {
    let results: BangumiSubject[];
    try {
      results = await attempt();
    } catch {
      continue; // a flaky endpoint shouldn't sink the whole lookup
    }
    const raw = pickBangumiChineseTitle(variants, results);
    if (raw) return toSimplified(raw);
  }
  return null;
}

/** PATCH just the title_chinese field of a row. */
export async function saveChineseTitle(id: number, value: string): Promise<void> {
  await patchRow(id, { title_chinese: value });
}

/**
 * Bangumi-direct rows have no English/romaji title, so English-mode display
 * falls through to the native (Japanese/Chinese) name. Bangumi's 别名 (alias)
 * infobox usually carries a Latin title — fetch the subject detail and mine it.
 * Returns null when there's no detail or no Latin alias.
 */
export function needsLatinTitle(row: MediaRow): boolean {
  return (
    row.external_source === "bangumi" &&
    !row.title_romaji &&
    !row.title_english &&
    !!row.external_id
  );
}

export async function lookupLatinTitle(
  row: MediaRow,
): Promise<LatinTitlePatch | null> {
  const id = Number(row.external_id);
  if (!Number.isInteger(id) || id <= 0) return null;

  // 1. Bangumi's own 别名 alias — a localized ENGLISH title (not romaji), so it
  //    goes in title_english. Works even for season parts AniList can't find.
  const detail = await getBangumiSubject(id);
  const alias = detail ? pickLatinAlias(detail.infobox) : null;
  if (alias) return { title_english: alias };

  // 2. Fallback: resolve to AniList by the native name (NFKC so fullwidth
  //    numerals match) and borrow its english/romaji. Catches rows that ARE on
  //    AniList but have no Bangumi alias (e.g. "Record of Ragnarok III").
  const native = row.title_native?.trim();
  if (!native) return null;
  const aniType = row.type === "manga" || row.type === "light_novel" ? "MANGA" : "ANIME";
  try {
    const results = await searchAniList(native.normalize("NFKC"), aniType, {
      perPage: 10,
    });
    const match = pickAniListMatch([native], results);
    if (match && (match.title.english || match.title.romaji)) {
      return {
        title_english: match.title.english,
        title_romaji: match.title.romaji,
      };
    }
  } catch {
    // AniList unreachable — nothing to add.
  }
  return null;
}

/** PATCH a row's Latin title fields. */
export async function saveLatinTitle(
  id: number,
  patch: LatinTitlePatch,
): Promise<void> {
  await patchRow(id, { ...patch } as Record<string, unknown>);
}

async function patchRow(
  id: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`/api/media/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`Failed to save title (HTTP ${res.status})`);
  }
}
