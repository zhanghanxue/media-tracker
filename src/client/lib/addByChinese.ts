// Add a media item the user found by searching Bangumi (typically by its
// Chinese name). Routing keeps the canonical-source-per-type invariant:
//
//   B (preferred) — resolve the picked subject to its AniList entry by native
//     name and add THAT (external_source: anilist). Keeps dedup clean and gives
//     rich AniList metadata; we set title_chinese from the picked subject (we
//     already know it, so no re-lookup).
//   A (fallback)  — no confident AniList match (donghua / manhua AniList lacks)
//     → add the Bangumi subject directly (external_source: bangumi), fetching
//     full detail (cover + episode count) and normalizing name_cn to Simplified.

import { searchAniList } from "../../worker/sources/anilist";
import {
  getBangumiSubject,
  type BangumiSubject,
} from "../../worker/sources/bangumi";
import { pickAniListMatch, pickLatinAlias } from "../../worker/sources/bangumi-mapper";
import { addMedia } from "./api";
import { saveChineseTitle } from "./enrich";
import { toSimplified } from "./toSimplified";
import type { MediaStatus } from "../../worker/db/schema";
import type { MediaRow } from "./types";

export async function addByBangumiSubject(
  subject: BangumiSubject,
  status: MediaStatus,
): Promise<MediaRow> {
  // Fetch full detail up front (alias infobox + cover + episode count). The
  // Latin alias both helps resolve to AniList and, failing that, becomes the
  // Bangumi-direct row's romaji title (via the mapper).
  const detail = (await getBangumiSubject(subject.id)) ?? subject;
  const latinAlias = pickLatinAlias(detail.infobox);
  const aniType = detail.type === 1 ? "MANGA" : "ANIME";

  // B: resolve to the canonical AniList entry. Search by the native name
  // (NFKC-normalized so fullwidth numerals like Ⅲ match AniList's "III") and by
  // the Latin alias; match against the native + alias. Exact-after-normalize, so
  // a miss safely falls through to a Bangumi-direct add.
  const targets = [detail.name, latinAlias];
  const queries = [detail.name.normalize("NFKC"), latinAlias].filter(
    (q): q is string => !!q && q.trim().length > 0,
  );
  let anilistMatch = null;
  for (const q of queries) {
    try {
      const results = await searchAniList(q, aniType, { perPage: 10 });
      anilistMatch = pickAniListMatch(targets, results);
      if (anilistMatch) break;
    } catch {
      // AniList unreachable for this query → try the next / fall through.
    }
  }

  if (anilistMatch) {
    try {
      const row = await addMedia({
        external_source: "anilist",
        status,
        media: anilistMatch,
      });
      // We already know the Chinese title (the picked subject) — set it directly
      // rather than re-deriving, unless the row already has one (409 re-add).
      const cn = detail.name_cn?.trim();
      if (!row.title_chinese && cn) {
        try {
          await saveChineseTitle(row.id, await toSimplified(cn));
        } catch {
          // best-effort; the row is already added
        }
      }
      return row;
    } catch {
      // The AniList add failed (e.g. an entry the mapper still can't classify).
      // Fall through to a Bangumi-direct add rather than failing the whole thing.
    }
  }

  // A: Bangumi-direct. Normalize name_cn to Simplified before the Worker
  // persists it; the mapper mines the alias infobox → title_romaji.
  const nameCn = detail.name_cn?.trim();
  const media: BangumiSubject = {
    ...detail,
    name_cn: nameCn ? await toSimplified(nameCn) : detail.name_cn,
  };
  return addMedia({ external_source: "bangumi", status, media });
}
