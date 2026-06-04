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
import type {
  Collection,
  CollectionInsert,
  ExternalSource,
  MediaInsert,
  MediaRow,
  MediaVideoPart,
} from "./schema";

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
  "release_date",
  "source_rating",
  "genres",
  "platform",
  "consumption_mode",
  "collection_id",
  "sort_order",
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

/**
 * Read just the `genres` column for rows matching an optional type filter — the
 * raw input to the facet tally (api/facets.ts). Returns one entry per row
 * (NULLs included; the tally ignores them). `types` empty = the whole library.
 * Type values come from a server-validated facet list, but we still bind them as
 * `?` placeholders.
 */
export async function selectGenresColumn(
  db: D1Database,
  types: string[],
): Promise<(string | null)[]> {
  const where =
    types.length > 0
      ? `WHERE type IN (${types.map(() => "?").join(", ")})`
      : "";
  const result = await db
    .prepare(`SELECT genres FROM media ${where}`)
    .bind(...types)
    .all<{ genres: string | null }>();
  return result.results.map((r) => r.genres);
}

export interface MediaListPage {
  items: MediaRow[];
  // Total rows matching the filters, ignoring limit/offset — lets the UI render
  // "showing 50 of 312" and drive pagination.
  total: number;
}

// Compact per-collection summary used to render collection cards WITHOUT loading
// the whole library to the client. `sampleTitles` carries the first few direct
// items' titles (enough for the longest-common-prefix name derivation) and
// `sampleCover` the first non-null direct cover; counts/dates roll the DIRECT
// items only — the client sums these across a collection's subtree using the
// (small) collection tree. All fields are derived in SQL, so the response size
// is O(#collections), not O(#items).
export interface CollectionRollup {
  collection_id: string;
  direct_count: number;
  // Status breakdown of the DIRECT items, so the client can roll a subtree up to
  // a single badge (all completed → completed, all planned → planned, else
  // in-progress) by summing across the subtree.
  completed_count: number;
  planned_count: number;
  // DIRECT items of type 'game' — lets the client suppress the completion bar on
  // a collection whose whole subtree is games (item-completion is meaningful, but
  // the user reads a progress bar there as an episode bar, which games lack).
  game_count: number;
  latest_updated: string | null;
  earliest_release: string | null;
  sample_cover: string | null;
  sample_titles: {
    title_native: string | null;
    title_romaji: string | null;
    title_english: string | null;
    title_chinese: string | null;
  }[];
}

// How many direct items to sample per collection for name/cover derivation. The
// longest-common-prefix name only needs a handful; cap keeps the payload tiny.
const ROLLUP_SAMPLE_SIZE = 5;

/**
 * Per-collection rollups for the drill-down UI. Two bounded queries:
 *   1. GROUP BY aggregate: direct count + newest activity + earliest release.
 *   2. The first ROLLUP_SAMPLE_SIZE direct items per collection (window
 *      function), for the common-prefix name + representative cover.
 * Both are O(#collections) in the response — never the whole library — so the
 * Worker's CPU/serialization stays flat as the library grows.
 */
export async function selectCollectionRollups(
  db: D1Database,
): Promise<CollectionRollup[]> {
  const aggSql = `
    SELECT collection_id,
           COUNT(*)                                          AS direct_count,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
           SUM(CASE WHEN status = 'planned'   THEN 1 ELSE 0 END) AS planned_count,
           SUM(CASE WHEN type = 'game'        THEN 1 ELSE 0 END) AS game_count,
           MAX(date_updated)                                 AS latest_updated,
           MIN(NULLIF(release_date, ''))                     AS earliest_release
    FROM media
    WHERE collection_id IS NOT NULL
    GROUP BY collection_id
  `;
  const sampleSql = `
    SELECT collection_id, title_native, title_romaji, title_english,
           title_chinese, cover_url
    FROM (
      SELECT collection_id, title_native, title_romaji, title_english,
             title_chinese, cover_url,
             ROW_NUMBER() OVER (
               PARTITION BY collection_id
               ORDER BY sort_order ASC, date_added ASC
             ) AS rn
      FROM media
      WHERE collection_id IS NOT NULL
    )
    WHERE rn <= ?
    ORDER BY collection_id, rn
  `;

  const [agg, samples] = await Promise.all([
    db
      .prepare(aggSql)
      .all<{
        collection_id: string;
        direct_count: number;
        completed_count: number;
        planned_count: number;
        game_count: number;
        latest_updated: string | null;
        earliest_release: string | null;
      }>(),
    db
      .prepare(sampleSql)
      .bind(ROLLUP_SAMPLE_SIZE)
      .all<{
        collection_id: string;
        title_native: string | null;
        title_romaji: string | null;
        title_english: string | null;
        title_chinese: string | null;
        cover_url: string | null;
      }>(),
  ]);

  const byId = new Map<string, CollectionRollup>();
  for (const r of agg.results) {
    byId.set(r.collection_id, {
      collection_id: r.collection_id,
      direct_count: r.direct_count,
      completed_count: r.completed_count,
      planned_count: r.planned_count,
      game_count: r.game_count,
      latest_updated: r.latest_updated,
      earliest_release: r.earliest_release,
      sample_cover: null,
      sample_titles: [],
    });
  }
  for (const s of samples.results) {
    const roll = byId.get(s.collection_id);
    if (!roll) continue; // aggregate is authoritative for which ids exist
    roll.sample_titles.push({
      title_native: s.title_native,
      title_romaji: s.title_romaji,
      title_english: s.title_english,
      title_chinese: s.title_chinese,
    });
    if (roll.sample_cover === null && s.cover_url) roll.sample_cover = s.cover_url;
  }
  return [...byId.values()];
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

  // `has_video_parts` is a derived 0/1 flag (correlated EXISTS, not a join) so a
  // card can show "linked" / open its video-links section without an extra
  // per-row fetch. One subquery on the page slice — O(page), CPU stays flat as
  // the library grows. WHERE/ORDER BY column names stay unqualified (single
  // table), so the builder's clauses keep resolving against `media`.
  const listSql = `SELECT media.*, EXISTS(SELECT 1 FROM media_video_parts WHERE media_id = media.id) AS has_video_parts FROM media ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
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
 * Feature B (Recommendations): a bounded set of a type's library rows to seed
 * recommendations from. Completed first, then in_progress, newest within each
 * (a finished favourite is a stronger signal than something half-watched). The
 * LIMIT keeps external-call volume bounded regardless of library size. Only rows
 * with SOME source identity (so a seed id can be resolved) are returned. `type`
 * is a server-validated enum value, still bound as a `?` placeholder.
 */
export async function selectRecommendationSeeds(
  db: D1Database,
  type: string,
  limit: number,
): Promise<MediaRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM media
       WHERE type = ?
         AND status IN ('completed', 'in_progress')
         AND (external_id IS NOT NULL OR anilist_id IS NOT NULL
              OR tmdb_id IS NOT NULL OR igdb_id IS NOT NULL)
       ORDER BY (status = 'completed') DESC, date_updated DESC
       LIMIT ?`,
    )
    .bind(type, limit)
    .all<MediaRow>();
  return result.results;
}

/**
 * Feature B: every (source, external_id)-style identity the library holds — the
 * primary (external_source, external_id) PLUS each cross-reference id (migration
 * 0008) — as `${source}:${id}` keys, for excluding already-owned candidates. Also
 * returns the display-title columns so the caller can build a normalized-title
 * exclusion set for cross-source dedup. Reads the whole library once (bounded by
 * row count, one cheap query) — the recommend route runs it a single time.
 */
export interface LibraryIdentity {
  keys: string[]; // e.g. ["anilist:101922", "tmdb:movie:603", "bangumi:140001"]
  titles: (string | null)[];
}

export async function selectLibraryIdentities(
  db: D1Database,
): Promise<LibraryIdentity> {
  const result = await db
    .prepare(
      `SELECT external_source, external_id, anilist_id, tmdb_id, igdb_id, bangumi_id,
              title_native, title_romaji, title_english, title_chinese
       FROM media`,
    )
    .all<{
      external_source: string | null;
      external_id: string | null;
      anilist_id: string | null;
      tmdb_id: string | null;
      igdb_id: string | null;
      bangumi_id: string | null;
      title_native: string | null;
      title_romaji: string | null;
      title_english: string | null;
      title_chinese: string | null;
    }>();

  const keys: string[] = [];
  const titles: (string | null)[] = [];
  for (const r of result.results) {
    if (r.external_source && r.external_id) keys.push(`${r.external_source}:${r.external_id}`);
    if (r.anilist_id) keys.push(`anilist:${r.anilist_id}`);
    if (r.tmdb_id) keys.push(`tmdb:${r.tmdb_id}`);
    if (r.igdb_id) keys.push(`igdb:${r.igdb_id}`);
    if (r.bangumi_id) keys.push(`bangumi:${r.bangumi_id}`);
    titles.push(r.title_native, r.title_romaji, r.title_english, r.title_chinese);
  }
  return { keys, titles };
}

// --- Feature A: "What's New" scanner dismissals (migration 0010) -------------
// A dismissed new-season / sequel suggestion, keyed by the (source, external_id)
// the scan surfaces it under, so a dismissed item never reappears on re-scan.

export interface DismissedSuggestion {
  source: string;
  external_id: string;
}

/** Every dismissal as `${source}:${external_id}` keys, for a direct membership
 *  test against scan candidates. One small unbounded-by-library query. */
export async function listDismissedSuggestionKeys(
  db: D1Database,
): Promise<string[]> {
  const result = await db
    .prepare("SELECT source, external_id FROM dismissed_suggestions")
    .all<DismissedSuggestion>();
  return result.results.map((r) => `${r.source}:${r.external_id}`);
}

/** Record a dismissal. Idempotent: re-dismissing the same (source, external_id)
 *  is a no-op (the PK conflict is ignored), so a double-click can't error. */
export async function insertDismissedSuggestion(
  db: D1Database,
  source: string,
  externalId: string,
  kind: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO dismissed_suggestions (source, external_id, kind)
       VALUES (?, ?, ?)
       ON CONFLICT(source, external_id) DO NOTHING`,
    )
    .bind(source, externalId, kind)
    .run();
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
 * Apply the SAME validated patch to many rows at once (the bulk selection action:
 * e.g. drop a set of games into a collection + mark them completed). Column names
 * come only from MediaPatch's fixed keys (the validator gates them), so the
 * dynamic SET is injection-safe. Does NOT bump date_updated — a bulk organize
 * shouldn't flood the top of a date-sorted list. Returns the rows changed.
 */
export async function bulkUpdateMedia(
  db: D1Database,
  ids: number[],
  patch: MediaPatch,
): Promise<number> {
  const keys = Object.keys(patch) as (keyof MediaPatch)[];
  if (ids.length === 0 || keys.length === 0) return 0;
  const assignments = keys.map((k) => `${k} = ?`);
  const values = keys.map((k) => patch[k]);

  // Per-row completion fill — the SQL twin of applyCompletionFill (patch-media.ts),
  // which the single-item PATCH runs but bulk used to skip (so a bulk "set status →
  // completed" left progress untouched, unlike editing one item). Each row has its
  // own total, so the fill is a CASE expression rather than a precomputed value.
  // Skip a dimension the caller set explicitly (manual override wins); CASE falls
  // through to the existing current value when the total is unknown. These add no
  // placeholders, so the bind order (`...values, ...ids`) is unchanged.
  if (patch.status === "completed") {
    if (!keys.includes("current_episode")) {
      assignments.push(
        "current_episode = CASE WHEN total_episodes IS NOT NULL THEN total_episodes ELSE current_episode END",
      );
    }
    if (!keys.includes("current_chapter")) {
      assignments.push(
        "current_chapter = CASE WHEN total_chapters IS NOT NULL THEN total_chapters ELSE current_chapter END",
      );
    }
  }

  // Per-row planned reset — the SQL twin of applyPlannedReset (patch-media.ts):
  // moving items back to "planned" clears their recorded progress (a planned item
  // hasn't been started). Totals (show metadata) are left intact. Skip a dimension
  // the caller set explicitly. Clearing an already-null value is a harmless no-op,
  // so no CASE guard is needed.
  if (patch.status === "planned") {
    if (!keys.includes("current_episode")) assignments.push("current_episode = NULL");
    if (!keys.includes("current_chapter")) assignments.push("current_chapter = NULL");
  }

  const placeholders = ids.map(() => "?").join(", ");
  const result = await db
    .prepare(`UPDATE media SET ${assignments.join(", ")} WHERE id IN (${placeholders})`)
    .bind(...values, ...ids)
    .run();
  return result.meta.changes;
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

// --- Collections (migration 0005) ------------------------------------------
// A collection is a real row that can nest (parent_id) and hold media items
// (media.collection_id). These ops back the /api/collections routes.

/** All collections (the client builds the tree from the flat list). */
export async function listCollections(db: D1Database): Promise<Collection[]> {
  const result = await db
    .prepare("SELECT * FROM collections ORDER BY sort_order, name")
    .all<Collection>();
  return result.results;
}

export async function getCollection(
  db: D1Database,
  id: string,
): Promise<Collection | null> {
  return db
    .prepare("SELECT * FROM collections WHERE id = ?")
    .bind(id)
    .first<Collection>();
}

/** Insert a collection and return it. */
export async function insertCollection(
  db: D1Database,
  row: CollectionInsert,
): Promise<Collection> {
  const inserted = await db
    .prepare(
      "INSERT INTO collections (id, name, parent_id, cover_url, sort_order) VALUES (?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(row.id, row.name, row.parent_id, row.cover_url, row.sort_order)
    .first<Collection>();
  if (inserted === null) {
    throw new Error("insertCollection: INSERT ... RETURNING * returned no row");
  }
  return inserted;
}

/**
 * Create a collection only if `id` isn't taken — used by TMDB-season adds, whose
 * collection_id ("tmdb:tv:<id>") must point at a real row before the item insert.
 * Idempotent across the seasons of one show.
 */
export async function ensureCollection(
  db: D1Database,
  id: string,
  name: string | null = null,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO collections (id, name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING",
    )
    .bind(id, name)
    .run();
}

const COLLECTION_FIELDS = ["name", "cover_url", "parent_id", "sort_order"] as const;
export type CollectionPatch = Partial<
  Pick<Collection, (typeof COLLECTION_FIELDS)[number]>
>;

/** Apply a partial update (name/cover/parent/sort) and return the row, or null. */
export async function updateCollection(
  db: D1Database,
  id: string,
  patch: CollectionPatch,
): Promise<Collection | null> {
  const keys = (Object.keys(patch) as (keyof CollectionPatch)[]).filter((k) =>
    COLLECTION_FIELDS.includes(k),
  );
  if (keys.length === 0) return getCollection(db, id);
  const assignments = keys.map((k) => `${k} = ?`);
  const values = keys.map((k) => patch[k]);
  return db
    .prepare(`UPDATE collections SET ${assignments.join(", ")} WHERE id = ? RETURNING *`)
    .bind(...values, id)
    .first<Collection>();
}

/**
 * All collection ids in `rootId`'s subtree (including rootId itself), via a
 * recursive walk down parent_id. Drives subtree bulk-edits + cycle checks.
 */
export async function collectionSubtreeIds(
  db: D1Database,
  rootId: string,
): Promise<string[]> {
  const result = await db
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM collections WHERE id = ?
         UNION
         SELECT c.id FROM collections c JOIN sub ON c.parent_id = sub.id
       )
       SELECT id FROM sub`,
    )
    .bind(rootId)
    .all<{ id: string }>();
  return result.results.map((r) => r.id);
}

/**
 * Bulk-set item metadata (region / type / genres) on EVERY item in `rootId`'s
 * subtree (items directly in it + items in any descendant collection). Whitelist
 * keys only → injection-safe. Does NOT bump date_updated (a correction
 * shouldn't reorder a date-sorted list). Returns the number of items updated.
 */
export interface SubtreeItemFields {
  region?: string | null;
  type?: string;
  genres?: string | null;
}

export async function updateSubtreeItemFields(
  db: D1Database,
  rootId: string,
  fields: SubtreeItemFields,
): Promise<number> {
  const keys = Object.keys(fields) as (keyof SubtreeItemFields)[];
  if (keys.length === 0) return 0;
  const ids = await collectionSubtreeIds(db, rootId);
  if (ids.length === 0) return 0;
  const assignments = keys.map((k) => `${k} = ?`);
  const values = keys.map((k) => fields[k]);
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `UPDATE media SET ${assignments.join(", ")} WHERE collection_id IN (${placeholders})`,
    )
    .bind(...values, ...ids)
    .run();
  return result.meta.changes;
}

/**
 * Delete a collection, re-parenting its contents UP to its own parent so nothing
 * is lost: its sub-collections' parent_id and its member items' collection_id
 * both move to the deleted node's parent (NULL → they become root/loose).
 * Returns true if a collection was removed.
 */
export async function deleteCollection(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const existing = await getCollection(db, id);
  if (!existing) return false;
  const parent = existing.parent_id; // may be null → contents go to root/loose
  await db
    .prepare("UPDATE collections SET parent_id = ? WHERE parent_id = ?")
    .bind(parent, id)
    .run();
  await db
    .prepare("UPDATE media SET collection_id = ? WHERE collection_id = ?")
    .bind(parent, id)
    .run();
  const result = await db
    .prepare("DELETE FROM collections WHERE id = ?")
    .bind(id)
    .run();
  return result.meta.changes > 0;
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

// --- Video parts (media_video_parts) ---------------------------------------
// Watching-mode content tracked as a list of URLs (e.g. a game's letsplay split
// across many videos). Ordered by part_number; the child table cascades on a
// media delete.

export async function listVideoParts(
  db: D1Database,
  mediaId: number,
): Promise<MediaVideoPart[]> {
  const result = await db
    .prepare(
      "SELECT * FROM media_video_parts WHERE media_id = ? ORDER BY part_number",
    )
    .bind(mediaId)
    .all<MediaVideoPart>();
  return result.results;
}

/**
 * Append a video part with the next part_number (max+1, starting at 1). Returns
 * the inserted row. Caller has verified the parent media exists.
 */
export async function addVideoPart(
  db: D1Database,
  mediaId: number,
  url: string,
  title: string | null,
): Promise<MediaVideoPart> {
  const next = await db
    .prepare(
      "SELECT COALESCE(MAX(part_number), 0) + 1 AS n FROM media_video_parts WHERE media_id = ?",
    )
    .bind(mediaId)
    .first<{ n: number }>();
  const partNumber = next?.n ?? 1;

  const inserted = await db
    .prepare(
      "INSERT INTO media_video_parts (media_id, part_number, title, url) VALUES (?, ?, ?, ?) RETURNING *",
    )
    .bind(mediaId, partNumber, title, url)
    .first<MediaVideoPart>();
  if (inserted === null) {
    throw new Error("addVideoPart: INSERT ... RETURNING * returned no row");
  }
  return inserted;
}

/**
 * Edit one video part's url and/or title (scoped to its media). part_number is
 * NOT editable here — ordering is owned by add (append) / future reordering, not
 * the edit. A null/blank title clears it. Returns the updated row, or null if no
 * part with that (id, media_id) exists.
 */
export async function updateVideoPart(
  db: D1Database,
  mediaId: number,
  partId: number,
  url: string,
  title: string | null,
): Promise<MediaVideoPart | null> {
  return db
    .prepare(
      "UPDATE media_video_parts SET url = ?, title = ? WHERE id = ? AND media_id = ? RETURNING *",
    )
    .bind(url, title, partId, mediaId)
    .first<MediaVideoPart>();
}

/** Delete one part (scoped to its media). Returns true if a row was removed. */
export async function deleteVideoPart(
  db: D1Database,
  mediaId: number,
  partId: number,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM media_video_parts WHERE id = ? AND media_id = ?")
    .bind(partId, mediaId)
    .run();
  return result.meta.changes > 0;
}

/**
 * Insert a mapped row and return the persisted record (with DB-assigned `id`,
 * `date_added`, `date_updated`). Uses `RETURNING *` so we don't round-trip a
 * second SELECT.
 */
/**
 * The DISTINCT non-null collection_ids whose DIRECT items match `filters`. The
 * drill-down uses this under an active filter/search to decide which collection
 * cards to surface (then expands to ancestors client-side via the small tree),
 * without shipping the matching items themselves. Reuses the same WHERE builder
 * as the list, minus its own collection scope (we want matches anywhere). Bounded
 * by #collections.
 */
export async function selectMatchingCollectionIds(
  db: D1Database,
  filters: ListFilters,
): Promise<string[]> {
  // Ignore any collection scope here — we want every collection with a match.
  const { where, params } = buildMediaListQuery({ ...filters, collection: null });
  const scope = where ? `${where} AND collection_id IS NOT NULL` : "WHERE collection_id IS NOT NULL";
  const result = await db
    .prepare(`SELECT DISTINCT collection_id FROM media ${scope}`)
    .bind(...params)
    .all<{ collection_id: string }>();
  return result.results.map((r) => r.collection_id);
}

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
      row.release_date,
      row.source_rating,
      row.genres,
      row.platform,
      row.consumption_mode,
      row.collection_id,
      row.sort_order,
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
