// Cross-reference id helpers (migration 0008). A row has ONE primary source
// (external_source + external_id) plus optional cross-reference ids to the other
// sources (anilist_id / tmdb_id / igdb_id / bangumi_id).
//
// Because we did NOT backfill the new columns, "the AniList id of this row" can
// live in EITHER place: in anilist_id (a cross-reference set in the editor), OR
// in external_id when AniList is already the primary source (the pre-0008 rows).
// These helpers read both, primary-source-first, so existing data keeps working
// untouched and newly-linked rows resolve too.

import type { ExternalSource, MediaRow } from "./types";

type RefRow = Pick<
  MediaRow,
  | "external_source"
  | "external_id"
  | "anilist_id"
  | "tmdb_id"
  | "igdb_id"
  | "bangumi_id"
>;

function refIdOf(row: RefRow, source: ExternalSource): string | null {
  // Primary source wins — its id lives in external_id (and for legacy rows that's
  // the ONLY place it is). Otherwise read the dedicated cross-reference column.
  if (row.external_source === source) return row.external_id;
  switch (source) {
    case "anilist":
      return row.anilist_id;
    case "tmdb":
      return row.tmdb_id;
    case "igdb":
      return row.igdb_id;
    case "bangumi":
      return row.bangumi_id;
    default:
      return null;
  }
}

export const anilistIdOf = (row: RefRow) => refIdOf(row, "anilist");
export const tmdbIdOf = (row: RefRow) => refIdOf(row, "tmdb");
export const igdbIdOf = (row: RefRow) => refIdOf(row, "igdb");
export const bangumiIdOf = (row: RefRow) => refIdOf(row, "bangumi");

// The MediaPatch column a freshly-picked cross-reference id should be written to,
// given the row's PRIMARY source. We never overwrite external_id; if the picked
// source is already primary there's nothing to link (returns null → no-op).
export function crossRefColumnFor(
  primarySource: ExternalSource | null,
  pickedSource: ExternalSource,
): "anilist_id" | "tmdb_id" | "igdb_id" | "bangumi_id" | null {
  if (primarySource === pickedSource) return null;
  return `${pickedSource}_id` as
    | "anilist_id"
    | "tmdb_id"
    | "igdb_id"
    | "bangumi_id";
}
