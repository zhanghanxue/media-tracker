// MediaRepository — the only place that talks SQL to the `media` table.
// Spec-first hybrid per TESTING.md: schema + query shape are ours, so the
// integration tests run against a REAL D1 (vitest-pool-workers), never a mock.
//
// Insertion takes an `AniListMapperResult` (the 15 columns the AniList import
// path populates). Columns the importer doesn't touch — platform,
// consumption_mode, game_progress, runtime_minutes, notes — fall to their SQL
// defaults (NULL), and date_added / date_updated default to datetime('now').

import type { AniListMapperResult } from "../sources/anilist-mapper";
import type { ListFilters } from "../api/list-query";
import { buildMediaListQuery } from "../api/media-query-builder";
import type { ExternalSource, MediaRow } from "./schema";

const INSERT_COLUMNS = [
  "type",
  "region",
  "title_native",
  "title_romaji",
  "title_english",
  "title_chinese",
  "status",
  "is_rewatching",
  "cover_url",
  "external_id",
  "external_source",
  "current_episode",
  "total_episodes",
  "current_chapter",
  "total_chapters",
] as const;

const INSERT_SQL = `
  INSERT INTO media (${INSERT_COLUMNS.join(", ")})
  VALUES (${INSERT_COLUMNS.map(() => "?").join(", ")})
  RETURNING *
`;

/**
 * Look up an existing row by its source identity. This is the idempotency /
 * conflict probe for POST /api/media — `(external_source, external_id)` is the
 * soft unique key. Returns null when no row matches.
 */
export async function findByExternalRef(
  db: D1Database,
  externalSource: ExternalSource,
  externalId: string,
): Promise<MediaRow | null> {
  return db
    .prepare(
      "SELECT * FROM media WHERE external_source = ? AND external_id = ?",
    )
    .bind(externalSource, externalId)
    .first<MediaRow>();
}

export async function findById(
  db: D1Database,
  id: number,
): Promise<MediaRow | null> {
  return db
    .prepare("SELECT * FROM media WHERE id = ?")
    .bind(id)
    .first<MediaRow>();
}

export interface MediaListPage {
  items: MediaRow[];
  // Total rows matching the filters, ignoring limit/offset — lets the UI render
  // "showing 50 of 312" and drive pagination.
  total: number;
}

/**
 * List rows matching `filters`, newest-first by default. Runs two queries: the
 * page (with LIMIT/OFFSET) and a COUNT(*) over the same WHERE for `total`. Both
 * share the builder's parameterized WHERE so the filter logic lives in exactly
 * one (pure, unit-tested) place.
 */
export async function listMedia(
  db: D1Database,
  filters: ListFilters,
): Promise<MediaListPage> {
  const { where, params, orderBy } = buildMediaListQuery(filters);

  const listSql = `SELECT * FROM media ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  const listResult = await db
    .prepare(listSql)
    .bind(...params, filters.limit, filters.offset)
    .all<MediaRow>();

  const countSql = `SELECT COUNT(*) AS total FROM media ${where}`;
  const countRow = await db
    .prepare(countSql)
    .bind(...params)
    .first<{ total: number }>();

  return { items: listResult.results, total: countRow?.total ?? 0 };
}

/**
 * Of the given external IDs (for one source), return the set that already
 * exist in the library. Used to annotate AniList search results with
 * "already added" so the UI can disable the Add button. Returns an empty set
 * for an empty input (avoids an invalid `IN ()`).
 */
export async function findExistingExternalIds(
  db: D1Database,
  externalSource: ExternalSource,
  externalIds: string[],
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();

  const placeholders = externalIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT external_id FROM media WHERE external_source = ? AND external_id IN (${placeholders})`,
    )
    .bind(externalSource, ...externalIds)
    .all<{ external_id: string }>();

  return new Set(result.results.map((r) => r.external_id));
}

/**
 * Insert a mapped row and return the persisted record (with DB-assigned `id`,
 * `date_added`, `date_updated`). Uses `RETURNING *` so we don't round-trip a
 * second SELECT.
 */
export async function insertMedia(
  db: D1Database,
  row: AniListMapperResult,
): Promise<MediaRow> {
  const inserted = await db
    .prepare(INSERT_SQL)
    .bind(
      row.type,
      row.region,
      row.title_native,
      row.title_romaji,
      row.title_english,
      row.title_chinese,
      row.status,
      row.is_rewatching,
      row.cover_url,
      row.external_id,
      row.external_source,
      row.current_episode,
      row.total_episodes,
      row.current_chapter,
      row.total_chapters,
    )
    .first<MediaRow>();

  if (inserted === null) {
    // RETURNING * on a successful INSERT always yields a row; a null here means
    // the insert silently failed, which should surface loudly rather than
    // returning a phantom success to the caller.
    throw new Error("insertMedia: INSERT ... RETURNING * returned no row");
  }

  return inserted;
}
