-- Migration 0007: add `release_date` — the work's actual air / release date
-- (NOT date_added/date_updated, which track library activity). Stored as a
-- padded ISO string `YYYY-MM-DD` (partials padded to the 1st; see
-- sources/release-date.ts) so SQLite's lexicographic TEXT sort orders it
-- chronologically. NULL = unknown (sorts last). Populated by every source
-- mapper on add and backfilled for existing rows by
-- scripts/backfill-release-dates.ts.

ALTER TABLE media ADD COLUMN release_date TEXT;

-- Indexed because it's a sort key (ORDER BY release_date) used by the list view
-- / collection ordering.
CREATE INDEX idx_media_release_date ON media(release_date);
