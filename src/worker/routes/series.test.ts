// Integration tests for PATCH /api/series/:id (rename across members) via
// vitest-pool-workers. Real D1; LOCAL_DEV_BYPASS satisfies auth. Rows are seeded
// straight through the repository, then linked by sharing a series_id.

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../index";
import {
  insertMedia,
  findById,
  renameSeries,
  setSeriesCover,
} from "../db/media-repository";
import type { MediaInsert } from "../db/schema";

function row(externalId: string): MediaInsert {
  return {
    type: "animation",
    region: "japan",
    title_native: null,
    title_romaji: null,
    title_english: `Entry ${externalId}`,
    title_chinese: null,
    status: "planned",
    is_rewatching: 0,
    cover_url: null,
    external_id: externalId,
    external_source: "anilist",
    current_episode: null,
    total_episodes: null,
    current_chapter: null,
    total_chapters: null,
    runtime_minutes: null,
    series_id: null,
    series_name: null,
    season_number: null,
  };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM media");
});

async function linkToSeries(id: number, seriesId: string, name: string) {
  await env.DB.prepare(
    "UPDATE media SET series_id = ?, series_name = ? WHERE id = ?",
  )
    .bind(seriesId, name, id)
    .run();
}

describe("PATCH /api/series/:id", () => {
  it("renames series_name on every member", async () => {
    const a = await insertMedia(env.DB, row("1"));
    const b = await insertMedia(env.DB, row("2"));
    const c = await insertMedia(env.DB, row("3")); // not in the series
    await linkToSeries(a.id, "s-aot", "进击的巨人");
    await linkToSeries(b.id, "s-aot", "进击的巨人");

    const res = await app.request(
      "/api/series/s-aot",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "进击的巨人（系列）" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { updated: number };
    expect(json.updated).toBe(2);

    expect((await findById(env.DB, a.id))!.series_name).toBe("进击的巨人（系列）");
    expect((await findById(env.DB, b.id))!.series_name).toBe("进击的巨人（系列）");
    expect((await findById(env.DB, c.id))!.series_name).toBeNull();
  });

  it("clears the override when name is null (revert to auto)", async () => {
    const a = await insertMedia(env.DB, row("1"));
    await linkToSeries(a.id, "s-x", "Custom Name");

    const res = await app.request(
      "/api/series/s-x",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: null }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect((await findById(env.DB, a.id))!.series_name).toBeNull();
  });

  it("404s when no row carries that series_id", async () => {
    const res = await app.request(
      "/api/series/ghost",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("400s on a blank name", async () => {
    const res = await app.request(
      "/api/series/whatever",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "   " }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("400s on an empty body (neither name nor cover_url)", async () => {
    const res = await app.request(
      "/api/series/whatever",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/series/:id — collection cover", () => {
  async function linkCover(id: number, seriesId: string) {
    await env.DB.prepare("UPDATE media SET series_id = ? WHERE id = ?")
      .bind(seriesId, id)
      .run();
  }

  it("pins series_cover_url on every member", async () => {
    const a = await insertMedia(env.DB, row("1"));
    const b = await insertMedia(env.DB, row("2"));
    const c = await insertMedia(env.DB, row("3")); // not in the series
    await linkCover(a.id, "s-cov");
    await linkCover(b.id, "s-cov");

    const res = await app.request(
      "/api/series/s-cov",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cover_url: "https://covers.example/s2.jpg" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { updated: number }).toEqual({ updated: 2 });

    expect((await findById(env.DB, a.id))!.series_cover_url).toBe(
      "https://covers.example/s2.jpg",
    );
    expect((await findById(env.DB, b.id))!.series_cover_url).toBe(
      "https://covers.example/s2.jpg",
    );
    expect((await findById(env.DB, c.id))!.series_cover_url).toBeNull();
  });

  it("clears the override when cover_url is null", async () => {
    const a = await insertMedia(env.DB, row("1"));
    await linkCover(a.id, "s-cov");
    await setSeriesCover(env.DB, "s-cov", "https://covers.example/pinned.jpg");

    const res = await app.request(
      "/api/series/s-cov",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cover_url: null }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect((await findById(env.DB, a.id))!.series_cover_url).toBeNull();
  });

  it("404s when no row carries that series_id", async () => {
    const res = await app.request(
      "/api/series/ghost",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cover_url: "https://covers.example/x.jpg" }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("400s on a blank cover_url", async () => {
    const res = await app.request(
      "/api/series/whatever",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cover_url: "   " }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("renameSeries (repository)", () => {
  it("returns 0 when the series doesn't exist", async () => {
    expect(await renameSeries(env.DB, "nope", "x")).toBe(0);
  });
});

describe("setSeriesCover (repository)", () => {
  it("returns 0 when the series doesn't exist", async () => {
    expect(await setSeriesCover(env.DB, "nope", "x")).toBe(0);
  });
});
