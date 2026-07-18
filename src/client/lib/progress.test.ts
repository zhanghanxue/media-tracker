import { describe, expect, it } from "vitest";

import { mediaProgress, nextIncrementPatch } from "./progress";
import type { MediaRow } from "./types";

// Minimal row factory — only the fields mediaProgress reads matter.
function row(overrides: Partial<MediaRow>): MediaRow {
  return {
    id: 1,
    type: "animation",
    region: "japan",
    title_native: null,
    title_romaji: null,
    title_english: "X",
    title_chinese: null,
    status: "in_progress",
    is_rewatching: 0,
    cover_url: null,
    external_id: "1",
    external_source: "anilist",
    anilist_id: null,
    tmdb_id: null,
    igdb_id: null,
    bangumi_id: null,
    notes: null,
    current_episode: null,
    total_episodes: null,
    current_chapter: null,
    total_chapters: null,
    platform: null,
    consumption_mode: null,
    game_progress: null,
    genres: null,
    runtime_minutes: null,
    release_date: null,
    source_rating: null,
    title_sort_zh: null,
    collection_id: null,
    sort_order: null,
    date_added: "2026-01-01",
    date_updated: "2026-01-01",
    ...overrides,
  };
}

describe("mediaProgress", () => {
  it("uses episode counts for animation", () => {
    expect(
      mediaProgress(row({ type: "animation", current_episode: 5, total_episodes: 26 })),
    ).toEqual({ kind: "episodes", current: 5, total: 26 });
  });

  it("uses chapter counts for manga and light_novel", () => {
    expect(
      mediaProgress(row({ type: "manga", current_chapter: 10, total_chapters: 200 })),
    ).toEqual({ kind: "chapters", current: 10, total: 200 });
    expect(
      mediaProgress(row({ type: "light_novel", current_chapter: 3, total_chapters: null })),
    ).toEqual({ kind: "chapters", current: 3, total: null });
  });

  it("uses free-text progress for a game in playing mode", () => {
    expect(
      mediaProgress(
        row({ type: "game", consumption_mode: "playing", game_progress: "Chapter 7" }),
      ),
    ).toEqual({ kind: "text", value: "Chapter 7" });
  });

  it("returns none for a playing game with no progress text", () => {
    expect(
      mediaProgress(row({ type: "game", consumption_mode: "playing", game_progress: null })),
    ).toEqual({ kind: "none" });
  });

  it("uses episode counts for a game in watching mode", () => {
    expect(
      mediaProgress(
        row({ type: "game", consumption_mode: "watching", current_episode: 2, total_episodes: 12 }),
      ),
    ).toEqual({ kind: "episodes", current: 2, total: 12 });
  });
});

describe("nextIncrementPatch", () => {
  it("increments current_episode for animation", () => {
    expect(
      nextIncrementPatch(row({ type: "animation", current_episode: 5 })),
    ).toEqual({ current_episode: 6 });
  });

  it("counts from 0 when current_episode is null", () => {
    expect(
      nextIncrementPatch(row({ type: "animation", current_episode: null })),
    ).toEqual({ current_episode: 1 });
  });

  it("increments current_chapter for manga / light_novel", () => {
    expect(
      nextIncrementPatch(row({ type: "manga", current_chapter: 41 })),
    ).toEqual({ current_chapter: 42 });
  });

  it("returns null for a game in playing mode (free-text progress)", () => {
    expect(
      nextIncrementPatch(row({ type: "game", consumption_mode: "playing" })),
    ).toBeNull();
  });
});
