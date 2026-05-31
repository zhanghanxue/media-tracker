-- Migration 0009: `source_rating` — the work's rating FROM ITS SOURCE, normalized
-- to a 0–10 REAL (AniList averageScore/10, IGDB rating/10, TMDB vote_average and
-- Bangumi rating.score are already 0–10). NULL = the source had no score, or the
-- row predates this column. PRD-v2 Feature D adds a "Rating" sort over it.
--
-- This is the SOURCE's rating, not a user rating — there is no user-entered
-- rating field (deliberate: the user asked to sort by the external score).
--
-- ADDITIVE: existing rows get NULL until the paced backfill script
-- (scripts/backfill-source-ratings.ts) re-fetches each source's score. New adds
-- populate it via the mappers.

ALTER TABLE media ADD COLUMN source_rating REAL;

-- Indexed: it's a sort key (ORDER BY source_rating) for the list / collection views.
CREATE INDEX idx_media_source_rating ON media(source_rating);
