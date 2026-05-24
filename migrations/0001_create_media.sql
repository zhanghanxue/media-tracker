-- Migration 0001: create the media tracker schema.
--
-- Schema mirror of DESIGN.md § "Proposed schema (v1)". Both `media` and
-- `media_video_parts` live in this single migration because they're
-- co-created and the foreign key requires `media` to exist first —
-- splitting into 0001_ + 0002_ would just add ceremony without value.
--
-- Foreign-key cascade enforcement: D1 enables `PRAGMA foreign_keys = ON`
-- per connection by default, so the ON DELETE CASCADE on
-- media_video_parts.media_id will actually fire when a parent row is
-- deleted (verified during Phase 2 acceptance).

CREATE TABLE media (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL,  -- animation | manga | light_novel | drama | movie | game
  region          TEXT,           -- japan | china | korea | usa | uk | taiwan | hong_kong | ...

  -- Multilingual titles
  title_native    TEXT,
  title_romaji    TEXT,
  title_english   TEXT,
  title_chinese   TEXT,

  -- Status & shared metadata
  status          TEXT NOT NULL,  -- planned | in_progress | completed | dropped | paused
  is_rewatching   INTEGER NOT NULL DEFAULT 0,
  cover_url       TEXT,           -- R2 URL
  external_id     TEXT,           -- ID in the source API
  external_source TEXT,           -- anilist | tmdb | igdb | bangumi
  notes           TEXT,

  -- Episodic progress: animation, drama, manga, light_novel, game (watching mode)
  current_episode INTEGER,
  total_episodes  INTEGER,
  current_chapter INTEGER,
  total_chapters  INTEGER,

  -- Game-specific
  platform         TEXT,          -- mobile | console | pc | handheld | arcade (games only)
  consumption_mode TEXT,          -- 'playing' | 'watching' (games only)
  game_progress    TEXT,          -- free text: "Chapter 7", "60%", "Yoshiwara" (playing mode only)
  -- Video URLs for watching-mode games live in media_video_parts (below), not on this row

  -- Movies
  runtime_minutes INTEGER,

  date_added      TEXT NOT NULL DEFAULT (datetime('now')),
  date_updated    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_media_type_status      ON media(type, status);
CREATE INDEX idx_media_region           ON media(region);
CREATE INDEX idx_media_date_updated     ON media(date_updated DESC);
CREATE INDEX idx_media_platform         ON media(platform);

-- Used only for games in watching mode (URL-as-content; see DESIGN.md §12).
-- Other watching-content types (animation, drama) track via episode numbers.
CREATE TABLE media_video_parts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id     INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  part_number  INTEGER NOT NULL,
  title        TEXT,                          -- optional; e.g. "Part 7: Babylonia"
  url          TEXT NOT NULL,
  UNIQUE (media_id, part_number)
);

CREATE INDEX idx_media_video_parts_media_id ON media_video_parts(media_id);
