// TypeScript mirror of `migrations/0001_create_media.sql`.
// Keep in sync with DESIGN.md § "Proposed schema (v1)".

export type MediaType =
  | "animation"
  | "manga"
  | "light_novel"
  | "drama"
  | "movie"
  | "game";

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
  notes: string | null;

  // Series grouping (migration 0002). NULL = ungrouped. series_name is
  // denormalized onto every member; season_number orders members in a group.
  series_id: string | null;
  series_name: string | null;
  season_number: number | null;

  // Per-series cover override (migration 0003), denormalized onto every member.
  // NULL = no override → the grouped card falls back to its first member's cover.
  series_cover_url: string | null;

  current_episode: number | null;
  total_episodes: number | null;
  current_chapter: number | null;
  total_chapters: number | null;

  platform: MediaPlatform | null;
  consumption_mode: MediaConsumptionMode | null;
  game_progress: string | null;

  runtime_minutes: number | null;

  date_added: string;
  date_updated: string;
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
  // Game fields: only IGDB adds populate these at insert time (consumption_mode
  // drives the card's tracking model, so a "playing" game must carry it from the
  // start); every other mapper sets them null.
  | "platform"
  | "consumption_mode"
  // Series grouping: only TMDB season adds populate these at insert time; every
  // other mapper sets them null (a row starts ungrouped and is linked later).
  | "series_id"
  | "series_name"
  | "season_number"
>;
