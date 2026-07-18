-- Migration 0012: `title_sort_zh` — a precomputed pinyin sort key for the zh
-- title sort (title_zh / title_zh_desc). SQLite code-point-orders CJK (火 > 死),
-- which is backwards for pinyin, and the list is server-paginated, so the pinyin
-- order can't be reconstructed client-side. We store toneless pinyin of the
-- zh-display title (COALESCE(title_chinese, title_native, title_english,
-- title_romaji)) and ORDER BY it — see src/worker/sources/titleSortKey.ts.
--
-- ADDITIVE: existing rows get NULL until the backfill script
-- (scripts/backfill-title-sort-zh.ts) fills them; the title_zh ORDER BY
-- COALESCEs back to the raw title columns for any row still NULL. New adds/edits
-- populate it via the mappers + the PATCH recompute.

ALTER TABLE media ADD COLUMN title_sort_zh TEXT;

-- Indexed: it's a sort key (ORDER BY title_sort_zh) for the list / collection views.
CREATE INDEX idx_media_title_sort_zh ON media(title_sort_zh);
