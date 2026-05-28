// Derive a card's progress display from a media row. Pure → unit-tested.
// The component turns the returned descriptor into a localized string via t().
//
// v1 only ingests AniList (animation / manga / light_novel), so those are the
// meaningful branches; drama/movie use episodes too, and games use either the
// free-text playing progress or episode counts in watching mode.

import type { MediaPatch } from "../../worker/api/patch-media";
import type { MediaRow } from "./types";

export type Progress =
  | { kind: "episodes"; current: number | null; total: number | null }
  | { kind: "chapters"; current: number | null; total: number | null }
  | { kind: "text"; value: string }
  | { kind: "none" };

export function mediaProgress(media: MediaRow): Progress {
  if (media.type === "manga" || media.type === "light_novel") {
    return {
      kind: "chapters",
      current: media.current_chapter,
      total: media.total_chapters,
    };
  }

  if (media.type === "game") {
    if (media.consumption_mode === "playing") {
      return media.game_progress
        ? { kind: "text", value: media.game_progress }
        : { kind: "none" };
    }
    // watching-mode game → episode-style counts
    return {
      kind: "episodes",
      current: media.current_episode,
      total: media.total_episodes,
    };
  }

  // animation, drama, movie
  return {
    kind: "episodes",
    current: media.current_episode,
    total: media.total_episodes,
  };
}

/**
 * The patch a "+1" tap should send for this row, or null if the item has no
 * incrementable count (game in playing mode → free-text; or no dimension).
 * Counts from 0 when the current value is null.
 */
export function nextIncrementPatch(media: MediaRow): MediaPatch | null {
  const p = mediaProgress(media);
  if (p.kind === "episodes") {
    return { current_episode: (p.current ?? 0) + 1 };
  }
  if (p.kind === "chapters") {
    return { current_chapter: (p.current ?? 0) + 1 };
  }
  return null;
}
