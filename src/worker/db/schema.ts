// TypeScript mirror of `migrations/0001_create_media.sql`.
// Keep in sync with DESIGN.md § "Proposed schema (v1)".

export type MediaType =
  | "animation"
  | "manga"
  | "light_novel"
  | "drama"
  | "movie"
  | "game"
  | "variety"; // reality / variety shows (综艺) — episodic, like drama

export type MediaStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "dropped"
  | "paused";

// Region values are open-ended; the curated set covers the common cases but
// the column accepts any string so AniList's ISO-3166 fallback stays lossless.
export type MediaRegion =
  | "japan"
  | "china"
  | "korea"
  | "taiwan"
  | "hong_kong"
  | "usa"
  | "uk"
  | "thailand"
  | (string & {});

export type MediaPlatform =
  | "mobile"
  | "console"
  | "pc"
  | "handheld"
  | "arcade";

export type MediaConsumptionMode = "playing" | "watching";

export type ExternalSource = "anilist" | "tmdb" | "igdb" | "bangumi";

export interface MediaRow {
  id: number;
  type: MediaType;
  region: MediaRegion | null;

  title_native: string | null;
  title_romaji: string | null;
  title_english: string | null;
  title_chinese: string | null;

  status: MediaStatus;
  is_rewatching: 0 | 1;
  cover_url: string | null;
  external_id: string | null;
  external_source: ExternalSource | null;

  // Cross-reference ids to OTHER sources (migration 0008), alongside the primary
  // (external_source, external_id). NULL = not linked to that source. A row keeps
  // its source of record; these just point at the equivalent entry elsewhere
  // (e.g. a Bangumi-sourced anime carrying its anilist_id, a Bangumi-sourced game
  // carrying its igdb_id — PRD-v2 Issue A / Feature C). Read via the helpers in
  // src/client/lib/crossRef.ts, which fall back to external_id when that source
  // IS the primary one. tmdb_id is kind-prefixed like external_id ("tv:1399").
  anilist_id: string | null;
  tmdb_id: string | null;
  igdb_id: string | null;
  bangumi_id: string | null;

  notes: string | null;

  // Nested collections (migration 0005). collection_id is the collection this
  // item sits DIRECTLY in (NULL = loose, shown at its level's top); sort_order
  // orders it among its siblings. The collection's name/cover/parent live on the
  // `collections` table — see Collection below.
  collection_id: string | null;
  sort_order: number | null;

  current_episode: number | null;
  total_episodes: number | null;
  current_chapter: number | null;
  total_chapters: number | null;

  platform: MediaPlatform | null;
  consumption_mode: MediaConsumptionMode | null;
  game_progress: string | null;

  // Sentinel-delimited genre list `|A|B|` (migration 0004). NULL = unknown.
  // Source-native names with light cleanup; see sources/genres.ts.
  genres: string | null;

  runtime_minutes: number | null;

  // The work's actual air / release date as a padded ISO `YYYY-MM-DD` string
  // (partials padded to the 1st; see sources/release-date.ts). NULL = unknown.
  // Distinct from date_added/date_updated, which track library activity.
  release_date: string | null;

  // The work's rating FROM ITS SOURCE, normalized to 0–10 (migration 0009).
  // AniList averageScore/10, IGDB rating/10; TMDB vote_average + Bangumi
  // rating.score are already 0–10. NULL = no source score (or a pre-0009 row not
  // yet backfilled). This is the SOURCE's score — there is no user rating field.
  source_rating: number | null;

  // Precomputed pinyin sort key for the zh title sort (migration 0012). Toneless
  // pinyin of the zh-display title (COALESCE(title_chinese, title_native,
  // title_english, title_romaji)); the server ORDER BYs it for title_zh so CJK
  // sorts by pinyin under pagination. NULL = a pre-0012 row not yet backfilled
  // (the ORDER BY COALESCEs back to the raw titles). See sources/titleSortKey.ts.
  title_sort_zh: string | null;

  date_added: string;
  date_updated: string;

  // Derived flag (NOT a `media` column): 1 when this row has at least one
  // media_video_parts entry, else 0. Populated only by listMedia's correlated
  // EXISTS subquery; undefined on rows read by other queries. Lets a card show
  // "linked" and the editor default its video-links section open.
  has_video_parts?: 0 | 1;
}

export interface MediaVideoPart {
  id: number;
  media_id: number;
  part_number: number;
  title: string | null;
  url: string;
}

// The column subset every source mapper produces for an INSERT (the rest —
// notes, game_progress, id, dates — fall to their SQL defaults). aniListToMediaRow,
// bangumiToMediaRow, tmdbToMediaRow and igdbToMediaRow all return this exact
// shape, and insertMedia consumes it. `runtime_minutes` joined the set when TMDB
// (movies) shipped; `platform` + `consumption_mode` joined when IGDB (games)
// shipped — every non-game mapper sets them null.
export type MediaInsert = Pick<
  MediaRow,
  | "type"
  | "region"
  | "title_native"
  | "title_romaji"
  | "title_english"
  | "title_chinese"
  | "status"
  | "is_rewatching"
  | "cover_url"
  | "external_id"
  | "external_source"
  | "current_episode"
  | "total_episodes"
  | "current_chapter"
  | "total_chapters"
  | "runtime_minutes"
  // The work's air/release date (padded ISO). Every mapper now derives it from
  // its source's date field (sources/release-date.ts); null when the source has none.
  | "release_date"
  // The source's rating, normalized to 0–10 (migration 0009). Every mapper now
  // derives it from its source's score field; null when the source has none.
  | "source_rating"
  // Genres: every mapper now produces this (sentinel-delimited string or null).
  | "genres"
  // Game fields: only IGDB adds populate these at insert time (consumption_mode
  // drives the card's tracking model, so a "playing" game must carry it from the
  // start); every other mapper sets them null.
  | "platform"
  | "consumption_mode"
  // Collection placement: only TMDB season adds populate these at insert time
  // (collection_id = the show's collection, sort_order = season number); every
  // other mapper sets them null (a row starts loose and is linked later).
  | "collection_id"
  | "sort_order"
>;

// A collection: a named, optionally-nested grouping of media items and/or other
// collections (migration 0005). NULL name/cover_url → derived from the contents
// (see lib/collections.ts); NULL parent_id → a root collection.
export interface Collection {
  id: string;
  name: string | null;
  parent_id: string | null;
  cover_url: string | null;
  sort_order: number | null;
  date_added: string;
}

// The columns supplied when creating a collection; id/date_added are set by the
// caller / SQL default.
export type CollectionInsert = Pick<
  Collection,
  "id" | "name" | "parent_id" | "cover_url" | "sort_order"
>;
