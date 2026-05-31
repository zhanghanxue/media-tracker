// Backfill helper: given an existing library row (its source + external_id +
// type), re-fetch that source's DETAIL and return the genre list to store. Pure
// of HTTP wiring beyond the source clients themselves — the backfill script
// supplies creds + throttling. Mirrors the per-source genre extraction the
// mappers do at add time, so a re-fetched row gets the same genres a fresh add would.

import { getAniListDetail, extractAniListGenres } from "../../src/worker/sources/anilist";
import { getBangumiSubject } from "../../src/worker/sources/bangumi";
import { extractBangumiGenres } from "../../src/worker/sources/bangumi-mapper";
import { getTmdbDetail, type TmdbKind } from "../../src/worker/sources/tmdb";
import { extractTmdbGenres } from "../../src/worker/sources/tmdb-mapper";
import { getIgdbDetail, extractIgdbGenres } from "../../src/worker/sources/igdb";
import { joinGenres } from "../../src/worker/sources/genres";
import type { MediaType } from "../../src/worker/db/schema";

export interface GenreCreds {
  tmdbApiKey?: string;
  twitchId?: string;
  twitchSecret?: string;
}

// The fields of a library row the backfill needs.
export interface LibRow {
  id: number;
  type: MediaType;
  external_source: string | null;
  external_id: string | null;
  genres: string | null;
}

const isBook = (t: MediaType) => t === "manga" || t === "light_novel";

/** A row needs backfilling if it has a source identity but no genres yet. */
export function needsGenres(row: LibRow): boolean {
  return (
    !!row.external_source &&
    !!row.external_id &&
    (row.genres === null || row.genres === "")
  );
}

// Parse a TMDB external_id ("movie:603", "tv:1234", "tv:1234:s2") → { kind, id }.
// Season rows carry the show id; genres live on the show, so we fetch that.
function parseTmdbRef(externalId: string): { kind: TmdbKind; id: number } | null {
  const parts = externalId.split(":");
  const kind = parts[0];
  const id = Number(parts[1]);
  if ((kind !== "movie" && kind !== "tv") || !Number.isFinite(id)) return null;
  return { kind, id };
}

/**
 * Fetch the genre list for one row from its source. Returns [] when the source
 * is unconfigured (no creds), the id is unparseable, or the detail call fails —
 * the caller treats [] as "leave as-is / skip", never an error.
 */
export async function fetchGenresFor(
  row: LibRow,
  creds: GenreCreds,
): Promise<string[]> {
  const source = row.external_source;
  const ext = row.external_id ?? "";
  try {
    if (source === "anilist") {
      const media = await getAniListDetail(
        Number(ext),
        isBook(row.type) ? "MANGA" : "ANIME",
      );
      return media ? extractAniListGenres(media) : [];
    }
    if (source === "bangumi") {
      const subject = await getBangumiSubject(Number(ext));
      return subject ? extractBangumiGenres(subject) : [];
    }
    if (source === "tmdb") {
      if (!creds.tmdbApiKey) return [];
      const ref = parseTmdbRef(ext);
      if (!ref) return [];
      const detail = await getTmdbDetail(ref.id, ref.kind, {
        apiKey: creds.tmdbApiKey,
      });
      return detail ? extractTmdbGenres(detail) : [];
    }
    if (source === "igdb") {
      if (!creds.twitchId || !creds.twitchSecret) return [];
      const game = await getIgdbDetail(Number(ext), {
        clientId: creds.twitchId,
        clientSecret: creds.twitchSecret,
      });
      return game ? extractIgdbGenres(game) : [];
    }
  } catch {
    return [];
  }
  return [];
}

/** Encode the fetched genres for PATCH, or null when there are none. */
export function encodeGenres(genres: string[]): string | null {
  return joinGenres(genres);
}
