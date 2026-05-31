-- Nested collections. Promotes the flat `series_id` tag (migration 0002/0003) to
-- a real `collections` table whose rows can NEST via a self-referential
-- parent_id — so an "Iron Man" collection can sit inside an "MCU" collection,
-- to arbitrary depth, with mixed contents (a collection holds both
-- sub-collections AND loose items).
--
--   collections.id          the grouping key. Reuses the old series_id strings
--                           for migrated rows; new ones are "col:<uuid>".
--   collections.name        display name. NULL → auto-derive from the direct
--                           items' titles (preserves the per-language naming the
--                           flat series did via longest-common-prefix).
--   collections.parent_id   the enclosing collection (NULL = root). FK to
--                           collections(id); the API rejects cycles.
--   collections.cover_url   pinned collection cover. NULL → derive from the first
--                           descendant item's cover.
--   collections.sort_order  order among siblings (NULL → by name/date).
--
--   media.collection_id     the collection an item sits DIRECTLY in (NULL = loose,
--                           shown at its level's top). Replaces series_id.
--   media.sort_order        order within its collection (was season_number).
--
-- ADDITIVE: the legacy series_* columns are backfilled FROM, not dropped — they
-- stay as a rollback safety net for production data and are removed in a later
-- cleanup migration once this is proven stable.

CREATE TABLE IF NOT EXISTS collections (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  parent_id  TEXT REFERENCES collections (id),
  cover_url  TEXT,
  sort_order INTEGER,
  date_added TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections (parent_id);

ALTER TABLE media ADD COLUMN collection_id TEXT;
ALTER TABLE media ADD COLUMN sort_order INTEGER;

-- Each existing series → one ROOT collection (no nesting existed before). The
-- series_* columns are denormalized onto every member, so MAX() picks the single
-- shared value per group.
INSERT INTO collections (id, name, cover_url)
SELECT series_id, MAX(series_name), MAX(series_cover_url)
FROM media
WHERE series_id IS NOT NULL
GROUP BY series_id;

UPDATE media
SET collection_id = series_id,
    sort_order = season_number
WHERE series_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_collection_id ON media (collection_id);
