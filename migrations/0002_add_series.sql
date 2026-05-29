-- Series grouping. Lets several media rows (anime seasons, TMDB drama seasons,
-- franchise entries) sit under one series so the library can render a single
-- grouped card with per-season progress instead of N near-identical cards.
--
--   series_id      grouping key shared by every member (NULL = ungrouped).
--                  Sourced automatically where possible (TMDB show id, AniList
--                  sequel/prequel chain) or assigned by a manual link.
--   series_name    the series' display name, DENORMALIZED onto each member so the
--                  list query needs no join; a rename updates all members at once
--                  (PATCH /api/series/:id).
--   season_number  orders members within a group (TMDB provides it; manual links
--                  leave it NULL → fall back to date/title order).
--
-- All nullable; existing rows default to NULL (ungrouped), so this is additive
-- and back-compatible with every current row and mapper.
ALTER TABLE media ADD COLUMN series_id TEXT;
ALTER TABLE media ADD COLUMN series_name TEXT;
ALTER TABLE media ADD COLUMN season_number INTEGER;

CREATE INDEX IF NOT EXISTS idx_media_series_id ON media (series_id);
