-- Migration 0010: persisted dismissals for the "What's New" scanner (PRD-v2
-- Feature A). When the scan surfaces a new season / sequel the user doesn't want,
-- they dismiss it and it must not reappear on the next scan.
--
-- Keyed by (source, external_id) — the SAME identity the scan surfaces a
-- candidate by, so the dismissal lookup is a direct membership test:
--   • anilist : the sequel anime's AniList id (e.g. "153406")
--   • tmdb    : the missing season's row ref ("tv:1399:s8")
-- `kind` records what was dismissed (sequel | new_season) for debugging / a
-- future per-kind reset; it is NOT part of the identity.
--
-- Additive: a brand-new table, nothing else touched.
CREATE TABLE dismissed_suggestions (
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source, external_id)
);
