// Integration tests for MediaRepository against a REAL D1 (vitest-pool-workers).
// Migrations are applied to this isolated test DB by test/apply-migrations.ts
// (a setup file), so the `media` table exists with its real schema, defaults,
// and constraints — LIKE semantics, NOT NULL, AUTOINCREMENT all behave as prod.

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { AniListMapperResult } from "../sources/anilist-mapper";
import type { ListFilters } from "../api/list-query";
import {
  findByExternalRef,
  findById,
  insertMedia,
  listMedia,
  updateMedia,
} from "./media-repository";

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
  runtime_minutes: null,
  platform: null,
  consumption_mode: null,
  series_id: null,
  series_name: null,
  season_number: null,
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

// --- listMedia -------------------------------------------------------------

function makeRow(overrides: Partial<AniListMapperResult>): AniListMapperResult {
  return { ...ANIME_ROW, ...overrides };
}

function filters(overrides: Partial<ListFilters> = {}): ListFilters {
  return {
    types: [],
    regions: [],
    statuses: [],
    q: null,
    sort: "date_updated",
    limit: 50,
    offset: 0,
    ...overrides,
  };
}

// A small, varied corpus exercised by the filter/search tests.
async function seedCorpus(): Promise<void> {
  await insertMedia(
    env.DB,
    makeRow({
      external_id: "101922",
      type: "animation",
      region: "japan",
      status: "in_progress",
      title_english: "Demon Slayer: Kimetsu no Yaiba",
      title_native: "鬼滅の刃",
    }),
  );
  await insertMedia(
    env.DB,
    makeRow({
      external_id: "30002",
      type: "manga",
      region: "japan",
      status: "completed",
      title_english: "Berserk",
      title_native: "ベルセルク",
    }),
  );
  await insertMedia(
    env.DB,
    makeRow({
      external_id: "50000",
      type: "animation",
      region: "china",
      status: "planned",
      title_english: "Demon's Heart",
      title_native: "魔心",
    }),
  );
  await insertMedia(
    env.DB,
    makeRow({
      external_id: "999",
      type: "light_novel",
      region: "japan",
      status: "planned",
      title_english: "Re:Zero",
      title_native: "リゼロ",
    }),
  );
}

describe("listMedia — filtering", () => {
  it("returns everything with no filters", async () => {
    await seedCorpus();
    const { items, total } = await listMedia(env.DB, filters());
    expect(total).toBe(4);
    expect(items).toHaveLength(4);
  });

  it("filters by a single type (OR-within of one value)", async () => {
    await seedCorpus();
    const { items, total } = await listMedia(
      env.DB,
      filters({ types: ["animation"] }),
    );
    expect(total).toBe(2);
    expect(items.every((r) => r.type === "animation")).toBe(true);
  });

  it("ANDs across facets: animation + japan + in_progress matches one row", async () => {
    await seedCorpus();
    const { items, total } = await listMedia(
      env.DB,
      filters({
        types: ["animation"],
        regions: ["japan"],
        statuses: ["in_progress"],
      }),
    );
    expect(total).toBe(1);
    expect(items[0]!.external_id).toBe("101922");
  });

  it("ORs within a facet: type IN (animation, manga) matches three rows", async () => {
    await seedCorpus();
    const { total } = await listMedia(
      env.DB,
      filters({ types: ["animation", "manga"] }),
    );
    expect(total).toBe(3);
  });
});

describe("listMedia — search (q)", () => {
  it("matches across English titles case-insensitively (two 'demon' rows)", async () => {
    await seedCorpus();
    const { items, total } = await listMedia(env.DB, filters({ q: "demon" }));
    expect(total).toBe(2);
    expect(items.map((r) => r.external_id).sort()).toEqual(["101922", "50000"]);
  });

  it("matches a native (CJK) title via title_native LIKE", async () => {
    await seedCorpus();
    const { items, total } = await listMedia(env.DB, filters({ q: "鬼滅" }));
    expect(total).toBe(1);
    expect(items[0]!.external_id).toBe("101922");
  });

  it("returns nothing for a non-matching query", async () => {
    await seedCorpus();
    const { total } = await listMedia(env.DB, filters({ q: "zzzznomatch" }));
    expect(total).toBe(0);
  });
});

describe("listMedia — pagination", () => {
  it("limits the page but reports the full match count in total", async () => {
    await seedCorpus();
    const page = await listMedia(env.DB, filters({ limit: 2, offset: 0 }));
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(4); // total ignores LIMIT/OFFSET
  });

  it("advances via offset without overlap", async () => {
    await seedCorpus();
    const first = await listMedia(env.DB, filters({ limit: 2, offset: 0 }));
    const second = await listMedia(env.DB, filters({ limit: 2, offset: 2 }));

    const firstIds = first.items.map((r) => r.id);
    const secondIds = second.items.map((r) => r.id);
    expect(second.items).toHaveLength(2);
    // Disjoint pages.
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });
});

describe("updateMedia", () => {
  it("applies a partial update without clobbering other columns", async () => {
    const inserted = await insertMedia(
      env.DB,
      makeRow({ external_id: "1", title_english: "Keep Me", total_episodes: 26 }),
    );

    const updated = await updateMedia(env.DB, inserted.id, {
      current_episode: 5,
    });

    expect(updated).not.toBeNull();
    expect(updated!.current_episode).toBe(5);
    // Untouched columns survive.
    expect(updated!.title_english).toBe("Keep Me");
    expect(updated!.total_episodes).toBe(26);
  });

  it("bumps date_updated", async () => {
    const inserted = await insertMedia(env.DB, makeRow({ external_id: "2" }));
    await env.DB.exec(
      `UPDATE media SET date_updated = '2020-01-01 00:00:00' WHERE id = ${inserted.id}`,
    );

    const updated = await updateMedia(env.DB, inserted.id, { notes: "x" });
    expect(updated!.date_updated).not.toBe("2020-01-01 00:00:00");
  });

  it("returns null for a non-existent id", async () => {
    const updated = await updateMedia(env.DB, 999999, { status: "completed" });
    expect(updated).toBeNull();
  });
});

describe("listMedia — ordering", () => {
  it("defaults to date_updated DESC (most recently updated first)", async () => {
    await seedCorpus();
    // Force distinct, known update times so the order is deterministic.
    await env.DB.exec(
      "UPDATE media SET date_updated = '2026-01-01 00:00:00' WHERE external_id = '101922'",
    );
    await env.DB.exec(
      "UPDATE media SET date_updated = '2026-03-01 00:00:00' WHERE external_id = '30002'",
    );
    await env.DB.exec(
      "UPDATE media SET date_updated = '2026-02-01 00:00:00' WHERE external_id = '50000'",
    );
    await env.DB.exec(
      "UPDATE media SET date_updated = '2026-04-01 00:00:00' WHERE external_id = '999'",
    );

    const { items } = await listMedia(env.DB, filters());
    expect(items.map((r) => r.external_id)).toEqual([
      "999", // Apr
      "30002", // Mar
      "50000", // Feb
      "101922", // Jan
    ]);
  });
});
