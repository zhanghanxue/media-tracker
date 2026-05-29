// Integration tests for GET /api/anilist/existing via vitest-pool-workers.
// Pure D1 membership lookup — no AniList call — so no fetchMock needed.
// LOCAL_DEV_BYPASS=1 satisfies the auth middleware.

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../index";
import { insertMedia } from "../db/media-repository";
import type { AniListMapperResult } from "../sources/anilist-mapper";

async function existing(qs: string): Promise<Response> {
  return app.request(`/api/anilist/existing?${qs}`, {}, env);
}

function row(externalId: string): AniListMapperResult {
  return {
    type: "animation",
    region: "japan",
    title_native: null,
    title_romaji: null,
    title_english: "X",
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

describe("GET /api/anilist/existing", () => {
  it("returns an empty list when no ids are given", async () => {
    const res = await existing("ids=");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { existing: string[] };
    expect(body.existing).toEqual([]);
  });

  it("returns an empty list when none are in the library", async () => {
    const res = await existing("ids=101922,30002");
    const body = (await res.json()) as { existing: string[] };
    expect(body.existing).toEqual([]);
  });

  it("returns only the ids already in the library", async () => {
    await insertMedia(env.DB, row("101922"));

    const res = await existing("ids=101922,30002");
    const body = (await res.json()) as { existing: string[] };
    expect(body.existing).toEqual(["101922"]);
  });
});
