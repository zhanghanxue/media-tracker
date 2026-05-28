// Integration tests for MediaRepository against a REAL D1 (vitest-pool-workers).
// Migrations are applied to this isolated test DB by test/apply-migrations.ts
// (a setup file), so the `media` table exists with its real schema, defaults,
// and constraints — LIKE semantics, NOT NULL, AUTOINCREMENT all behave as prod.

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { AniListMapperResult } from "../sources/anilist-mapper";
import { findByExternalRef, findById, insertMedia } from "./media-repository";

// A representative mapped anime row (what aniListToMediaRow returns for
// Kimetsu no Yaiba). Tests clone + tweak this.
const ANIME_ROW: AniListMapperResult = {
  type: "animation",
  region: "japan",
  title_native: "鬼滅の刃",
  title_romaji: "Kimetsu no Yaiba",
  title_english: "Demon Slayer: Kimetsu no Yaiba",
  title_chinese: null,
  status: "planned",
  is_rewatching: 0,
  cover_url: "https://covers.zhanghanxue.com/covers/anilist/101922.jpg",
  external_id: "101922",
  external_source: "anilist",
  current_episode: null,
  total_episodes: 26,
  current_chapter: null,
  total_chapters: null,
};

// Each test starts from an empty table so row counts / lookups are deterministic.
beforeEach(async () => {
  await env.DB.exec("DELETE FROM media");
});

describe("insertMedia", () => {
  it("persists the row and returns it with a DB-assigned id + timestamps", async () => {
    const inserted = await insertMedia(env.DB, ANIME_ROW);

    expect(inserted.id).toBeTypeOf("number");
    expect(inserted.id).toBeGreaterThan(0);
    // DB defaults filled in, not supplied by the mapper.
    expect(inserted.date_added).toBeTruthy();
    expect(inserted.date_updated).toBeTruthy();
    // Mapped fields round-trip unchanged.
    expect(inserted.type).toBe("animation");
    expect(inserted.title_native).toBe("鬼滅の刃");
    expect(inserted.total_episodes).toBe(26);
    expect(inserted.external_id).toBe("101922");
  });

  it("leaves importer-untouched columns at their NULL defaults", async () => {
    const inserted = await insertMedia(env.DB, ANIME_ROW);

    expect(inserted.platform).toBeNull();
    expect(inserted.consumption_mode).toBeNull();
    expect(inserted.game_progress).toBeNull();
    expect(inserted.runtime_minutes).toBeNull();
    expect(inserted.notes).toBeNull();
  });

  it("actually writes a row that can be read back", async () => {
    const inserted = await insertMedia(env.DB, ANIME_ROW);

    const fetched = await findById(env.DB, inserted.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.external_id).toBe("101922");
  });

  it("stores is_rewatching as an integer 0", async () => {
    const inserted = await insertMedia(env.DB, ANIME_ROW);
    expect(inserted.is_rewatching).toBe(0);
  });
});

describe("findByExternalRef", () => {
  it("returns null when no row matches the source identity", async () => {
    const found = await findByExternalRef(env.DB, "anilist", "999999");
    expect(found).toBeNull();
  });

  it("finds the row inserted under the same (source, external_id)", async () => {
    await insertMedia(env.DB, ANIME_ROW);

    const found = await findByExternalRef(env.DB, "anilist", "101922");
    expect(found).not.toBeNull();
    expect(found!.title_romaji).toBe("Kimetsu no Yaiba");
  });

  it("does not match a different external_id under the same source", async () => {
    await insertMedia(env.DB, ANIME_ROW);

    const found = await findByExternalRef(env.DB, "anilist", "101923");
    expect(found).toBeNull();
  });

  it("does not match the same external_id under a different source", async () => {
    await insertMedia(env.DB, ANIME_ROW);

    // Same numeric id, different source — must NOT collide.
    const found = await findByExternalRef(env.DB, "tmdb", "101922");
    expect(found).toBeNull();
  });
});
