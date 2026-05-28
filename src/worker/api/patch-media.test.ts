import { describe, expect, it } from "vitest";

import {
  applyAutoComplete,
  applyCompletionFill,
  parsePatchMediaRequest,
} from "./patch-media";
import type { MediaRow } from "../db/schema";

describe("parsePatchMediaRequest — valid", () => {
  it("accepts a single-field update", () => {
    const r = parsePatchMediaRequest({ current_episode: 5 });
    expect(r).toEqual({ ok: true, value: { current_episode: 5 } });
  });

  it("accepts a multi-field update", () => {
    const r = parsePatchMediaRequest({ status: "paused", notes: "hold" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ status: "paused", notes: "hold" });
  });

  it("accepts null to clear a nullable field", () => {
    const r = parsePatchMediaRequest({ game_progress: null });
    expect(r).toEqual({ ok: true, value: { game_progress: null } });
  });

  it("accepts is_rewatching 0 and 1", () => {
    expect(parsePatchMediaRequest({ is_rewatching: 1 }).ok).toBe(true);
    expect(parsePatchMediaRequest({ is_rewatching: 0 }).ok).toBe(true);
  });
});

describe("parsePatchMediaRequest — invalid", () => {
  it("rejects a non-object body", () => {
    expect(parsePatchMediaRequest("x").ok).toBe(false);
  });

  it("rejects an empty patch (nothing to update)", () => {
    const r = parsePatchMediaRequest({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("no updatable fields provided");
  });

  it("rejects an unknown field (e.g. video_url — not a media column)", () => {
    const r = parsePatchMediaRequest({ video_url: "https://x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("video_url"))).toBe(true);
  });

  it("rejects an invalid status", () => {
    expect(parsePatchMediaRequest({ status: "banana" }).ok).toBe(false);
  });

  it("rejects negative / float / string integers", () => {
    expect(parsePatchMediaRequest({ current_episode: -1 }).ok).toBe(false);
    expect(parsePatchMediaRequest({ current_episode: 1.5 }).ok).toBe(false);
    expect(parsePatchMediaRequest({ current_episode: "5" }).ok).toBe(false);
  });

  it("rejects an invalid consumption_mode", () => {
    expect(parsePatchMediaRequest({ consumption_mode: "binging" }).ok).toBe(
      false,
    );
  });

  it("rejects is_rewatching values other than 0/1", () => {
    expect(parsePatchMediaRequest({ is_rewatching: 2 }).ok).toBe(false);
    expect(parsePatchMediaRequest({ is_rewatching: true }).ok).toBe(false);
  });

  it("collects all errors at once", () => {
    const r = parsePatchMediaRequest({
      status: "banana",
      current_episode: -1,
      bogus: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(3);
  });
});

// --- applyAutoComplete -----------------------------------------------------

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
    notes: null,
    current_episode: null,
    total_episodes: null,
    current_chapter: null,
    total_chapters: null,
    platform: null,
    consumption_mode: null,
    game_progress: null,
    runtime_minutes: null,
    date_added: "2026-01-01",
    date_updated: "2026-01-01",
    ...overrides,
  };
}

describe("applyAutoComplete", () => {
  it("completes when a patched current_episode reaches the existing total", () => {
    const existing = row({ total_episodes: 26, current_episode: 20 });
    const result = applyAutoComplete(existing, { current_episode: 26 });
    expect(result.status).toBe("completed");
    expect(result.current_episode).toBe(26);
  });

  it("completes on chapters too (manga/light_novel)", () => {
    const existing = row({ type: "manga", total_chapters: 200 });
    const result = applyAutoComplete(existing, { current_chapter: 200 });
    expect(result.status).toBe("completed");
  });

  it("does NOT override an explicitly-set status (manual wins)", () => {
    const existing = row({ total_episodes: 26 });
    const result = applyAutoComplete(existing, {
      current_episode: 26,
      status: "paused",
    });
    expect(result.status).toBe("paused");
  });

  it("does not complete when current is below total", () => {
    const existing = row({ total_episodes: 26 });
    const result = applyAutoComplete(existing, { current_episode: 10 });
    expect(result.status).toBeUndefined();
  });

  it("does not complete when total is unknown (null)", () => {
    const existing = row({ total_episodes: null });
    const result = applyAutoComplete(existing, { current_episode: 12 });
    expect(result.status).toBeUndefined();
  });

  it("completes when current exceeds total (>=, not strict ==)", () => {
    const existing = row({ total_episodes: 12, current_episode: 11 });
    const result = applyAutoComplete(existing, { current_episode: 13 });
    expect(result.status).toBe("completed");
  });
});

describe("applyCompletionFill", () => {
  it("fills current_episode up to the total when marked completed", () => {
    const existing = row({ total_episodes: 26, current_episode: 12 });
    const result = applyCompletionFill(existing, { status: "completed" });
    expect(result.current_episode).toBe(26);
  });

  it("fills current_chapter up to the total for manga/light_novel", () => {
    const existing = row({ type: "manga", total_chapters: 200, current_chapter: 40 });
    const result = applyCompletionFill(existing, { status: "completed" });
    expect(result.current_chapter).toBe(200);
  });

  it("does nothing when the status isn't being set to completed", () => {
    const existing = row({ total_episodes: 26, current_episode: 12 });
    expect(applyCompletionFill(existing, { status: "paused" })).toEqual({
      status: "paused",
    });
    expect(applyCompletionFill(existing, { current_episode: 13 })).toEqual({
      current_episode: 13,
    });
  });

  it("respects an explicitly-set current in the same request", () => {
    const existing = row({ total_episodes: 26 });
    const result = applyCompletionFill(existing, {
      status: "completed",
      current_episode: 5,
    });
    expect(result.current_episode).toBe(5);
  });

  it("does nothing when the total is unknown", () => {
    const existing = row({ total_episodes: null, current_episode: 3 });
    const result = applyCompletionFill(existing, { status: "completed" });
    expect(result.current_episode).toBeUndefined();
  });
});
