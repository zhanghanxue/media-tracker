-- Re-run the 0005 collection backfill idempotently. A small number of series
-- (observed: 2 of 208 on prod) didn't get their collection row from 0005's bulk
-- INSERT…SELECT, leaving their items pointing at a collection_id with no
-- matching row (orphaned → invisible in the drill-down). INSERT OR IGNORE
-- re-attempts every series; the ones already present conflict on the PK and are
-- skipped, the missing ones get created. No-op where 0005 fully succeeded.
INSERT OR IGNORE INTO collections (id, name, cover_url)
SELECT series_id, MAX(series_name), MAX(series_cover_url)
FROM media
WHERE series_id IS NOT NULL
GROUP BY series_id;
