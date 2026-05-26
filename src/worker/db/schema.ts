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
