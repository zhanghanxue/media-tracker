// Pure mapping: an IGDB game → an insertable `media` row (type "game").
//
// IGDB gives one `name` (usually the English/romanized title); we store it as
// title_english so it displays in both UI languages (the zh fallback chain ends
// there). Games have no region in our sense → null. The two game-specific fields
// come from the ADD REQUEST, not IGDB: consumption_mode (Playing vs Watching,
// chosen via the add toggle) drives the card's tracking model, and platform is
// the user-confirmed bucket (auto-filled from IGDB's platforms in the browser,
// then sent here). game_progress starts null.

import type {
  ExternalSource,
  MediaConsumptionMode,
  MediaInsert,
  MediaPlatform,
  MediaStatus,
} from "../db/schema";
import { igdbCoverUrl, type IgdbGame } from "./igdb";

export type IgdbMapperResult = MediaInsert;

export interface IgdbMapOptions {
  status: MediaStatus;
  consumptionMode: MediaConsumptionMode;
  platform: MediaPlatform | null;
}

export function igdbToMediaRow(
  game: IgdbGame,
  opts: IgdbMapOptions,
): IgdbMapperResult {
  const name = game.name?.trim();
  return {
    type: "game",
    region: null, // games carry no region in our model; editor can set one
    title_native: null,
    title_romaji: null,
    title_english: name ? name : null,
    title_chinese: null,
    status: opts.status,
    is_rewatching: 0,
    cover_url: igdbCoverUrl(game.cover?.image_id),
    external_id: String(game.id),
    external_source: "igdb" satisfies ExternalSource,
    current_episode: null,
    total_episodes: null,
    current_chapter: null,
    total_chapters: null,
    runtime_minutes: null,
    platform: opts.platform,
    consumption_mode: opts.consumptionMode,
    series_id: null,
    series_name: null,
    season_number: null,
  };
}
