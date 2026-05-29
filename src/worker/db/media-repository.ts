// MediaRepository — the only place that talks SQL to the `media` table.
// Spec-first hybrid per TESTING.md: schema + query shape are ours, so the
// integration tests run against a REAL D1 (vitest-pool-workers), never a mock.
//
// Insertion takes a `MediaInsert` (the 15 columns every source mapper —
// AniList or Bangumi — populates). Columns no mapper touches — platform,
// consumption_mode, game_progress, runtime_minutes, notes — fall to their SQL
// defaults (NULL), and date_added / date_updated default to datetime('now').

import type { ListFilters } from "../api/list-query";
import type { MediaPatch } from "../api/patch-media";
import { buildMediaListQuery } from "../api/media-query-builder";
import type { ExternalSource, MediaInsert, MediaRow } from "./schema";

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
  "runtime_minutes",
  "platform",
  "consumption_mode",
  "series_id",
  "series_name",
  "season_number",
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
 * Apply a validated partial update and return the updated row (or null if no
 * row has that id). `date_updated` is always bumped. Column names come only
 * from MediaPatch's fixed keys (the validator never lets arbitrary strings in),
 * so the dynamic SET is injection-safe; values are bound as ? placeholders.
 */
export async function updateMedia(
  db: D1Database,
  id: number,
  patch: MediaPatch,
): Promise<MediaRow | null> {
  const keys = Object.keys(patch) as (keyof MediaPatch)[];

  const assignments = keys.map((k) => `${k} = ?`);
  assignments.push("date_updated = datetime('now')");
  const values = keys.map((k) => patch[k]);

  const sql = `UPDATE media SET ${assignments.join(", ")} WHERE id = ? RETURNING *`;
  return db
    .prepare(sql)
    .bind(...values, id)
    .first<MediaRow>();
}

/**
 * Delete a row by id. Returns true if a row was removed, false if no row had
 * that id (→ 404). The R2 cover object is left in place — it's harmless, cheap,
 * and keyed by (source, external_id) so a future re-add reuses it.
 */
export async function deleteMedia(
  db: D1Database,
  id: number,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM media WHERE id = ?")
    .bind(id)
    .run();
  return result.meta.changes > 0;
}

/**
 * Set `series_name` on every member sharing `seriesId`. `name` may be null to
 * CLEAR the manual override (reverting the group to its auto-derived,
 * per-language name). Returns the number of rows updated (0 if no such series).
 * Does NOT bump `date_updated` — a rename is metadata and shouldn't reorder a
 * date-sorted list.
 */
export async function renameSeries(
  db: D1Database,
  seriesId: string,
  name: string | null,
): Promise<number> {
  const result = await db
    .prepare("UPDATE media SET series_name = ? WHERE series_id = ?")
    .bind(name, seriesId)
    .run();
  return result.meta.changes;
}

/**
 * Set `series_cover_url` on every member sharing `seriesId` (the "pick
 * collection cover" override). `url` may be null to CLEAR the override (the
 * grouped card reverts to its first member's cover). Returns the number of rows
 * updated (0 if no such series). Like renameSeries, does NOT bump date_updated —
 * picking a cover is metadata and shouldn't reorder a date-sorted list.
 */
export async function setSeriesCover(
  db: D1Database,
  seriesId: string,
  url: string | null,
): Promise<number> {
  const result = await db
    .prepare("UPDATE media SET series_cover_url = ? WHERE series_id = ?")
    .bind(url, seriesId)
    .run();
  return result.meta.changes;
}

/**
 * Overwrite a single row's `cover_url` (the "refresh cover" action re-pulls the
 * origin-language poster and re-hosts it). Returns the updated row, or null if
 * no row has that id. Does NOT bump date_updated — a cover refresh is metadata,
 * not a progress event, so it shouldn't jump the item up a date-sorted list.
 */
export async function setCoverUrl(
  db: D1Database,
  id: number,
  url: string | null,
): Promise<MediaRow | null> {
  return db
    .prepare("UPDATE media SET cover_url = ? WHERE id = ? RETURNING *")
    .bind(url, id)
    .first<MediaRow>();
}

/**
 * Set a single row's `total_episodes` (the "update ongoing episodes" refresh:
 * a currently-airing show's latest count). Returns the updated row, or null if
 * no row has that id. Does NOT bump date_updated — refreshing the count across
 * many ongoing shows at once shouldn't flood the top of a date-sorted list.
 */
export async function setTotalEpisodes(
  db: D1Database,
  id: number,
  total: number,
): Promise<MediaRow | null> {
  return db
    .prepare("UPDATE media SET total_episodes = ? WHERE id = ? RETURNING *")
    .bind(total, id)
    .first<MediaRow>();
}

/**
 * Insert a mapped row and return the persisted record (with DB-assigned `id`,
 * `date_added`, `date_updated`). Uses `RETURNING *` so we don't round-trip a
 * second SELECT.
 */
export async function insertMedia(
  db: D1Database,
  row: MediaInsert,
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
      row.runtime_minutes,
      row.platform,
      row.consumption_mode,
      row.series_id,
      row.series_name,
      row.season_number,
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
