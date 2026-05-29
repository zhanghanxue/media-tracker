// Real source-search adapters for the import runner: wire the actual source
// clients into the matcher's injected SearchFn, converting each hit to a
// RawCandidate. Rate-limited per source. READ-ONLY — these only query public
// (or key-bearing, read) search endpoints; nothing here writes.

import { searchAniList } from "../../src/worker/sources/anilist";
import { searchBangumiBoth } from "../../src/client/lib/bangumiSearch";
import { searchTmdb } from "../../src/worker/sources/tmdb";
import { searchIgdb } from "../../src/worker/sources/igdb";
import type { BangumiType } from "../../src/worker/sources/bangumi";
import type { RawCandidate, SearchFn, Source } from "./match";

export interface SourceCreds {
  tmdbApiKey?: string;
  twitchId?: string;
  twitchSecret?: string;
}

// Minimum ms between calls per source (AniList caps ~90/min; IGDB ~4/s; Bangumi
// is flaky so we go gentle; TMDB is generous).
const MIN_INTERVAL: Record<Source, number> = {
  anilist: 750,
  bangumi: 450,
  tmdb: 80,
  igdb: 300,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function yearOf(date: string | null | undefined): number | null {
  if (!date) return null;
  const m = /(\d{4})/.exec(date);
  return m ? Number(m[1]) : null;
}

export function buildSearch(creds: SourceCreds): SearchFn {
  const lastAt: Partial<Record<Source, number>> = {};
  async function throttle(source: Source) {
    const wait = (lastAt[source] ?? 0) + MIN_INTERVAL[source] - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt[source] = Date.now();
  }

  return async (
    source: Source,
    subtype: string | number | null,
    query: string,
  ): Promise<RawCandidate[]> => {
    if (!query.trim()) return [];
    await throttle(source);
    try {
      if (source === "anilist") {
        const media = await searchAniList(query, subtype as "ANIME" | "MANGA", {
          perPage: 8,
        });
        return media.map((m) => ({
          source,
          id: String(m.id),
          titles: [m.title.native, m.title.romaji, m.title.english].filter(
            (t): t is string => !!t,
          ),
          year: m.seasonYear ?? null,
          payload: m,
        }));
      }

      if (source === "bangumi") {
        const subjects = await searchBangumiBoth(query, subtype as BangumiType);
        return subjects.slice(0, 8).map((s) => ({
          source,
          id: String(s.id),
          titles: [s.name, s.name_cn].filter((t): t is string => !!t),
          year: yearOf(s.date),
          payload: s,
        }));
      }

      if (source === "tmdb") {
        if (!creds.tmdbApiKey) return [];
        const kind = subtype as "movie" | "tv";
        const results = await searchTmdb(query, kind, { apiKey: creds.tmdbApiKey });
        return results.slice(0, 8).map((r) => ({
          source,
          id: String(r.id),
          titles: [
            kind === "movie" ? r.title : r.name,
            kind === "movie" ? r.original_title : r.original_name,
          ].filter((t): t is string => !!t),
          year: yearOf(kind === "movie" ? r.release_date : r.first_air_date),
          payload: { id: r.id, media_type: kind },
        }));
      }

      // igdb
      if (!creds.twitchId || !creds.twitchSecret) return [];
      const games = await searchIgdb(query, {
        clientId: creds.twitchId,
        clientSecret: creds.twitchSecret,
      });
      return games.slice(0, 8).map((g) => ({
        source,
        id: String(g.id),
        titles: [g.name, ...(g.alternative_names ?? []).map((a) => a.name ?? "")].filter(
          (t): t is string => !!t,
        ),
        year: g.first_release_date
          ? new Date(g.first_release_date * 1000).getUTCFullYear()
          : null,
        payload: { id: g.id },
      }));
    } catch {
      // A single source hiccup shouldn't sink the entry — the matcher just sees
      // no candidates from this source and falls through / buckets accordingly.
      return [];
    }
  };
}
