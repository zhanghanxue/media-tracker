// Integration tests for GET /api/anilist/search via vitest-pool-workers.
// Real D1 (for the already-added annotation); AniList GraphQL mocked via
// fetchMock. LOCAL_DEV_BYPASS=1 satisfies the auth middleware.

import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import app from "../index";
import { insertMedia } from "../db/media-repository";
import type { AniListMapperResult } from "../sources/anilist-mapper";
import searchAnimeFixture from "../../../test/fixtures/anilist/search_anime_kimetsu.json";

const ANILIST_ORIGIN = "https://graphql.anilist.co";

async function search(qs: string): Promise<Response> {
  return app.request(`/api/anilist/search?${qs}`, {}, env);
}

function mockSearch(payload: object = searchAnimeFixture): void {
  fetchMock
    .get(ANILIST_ORIGIN)
    .intercept({ method: "POST", path: "/" })
    .reply(200, payload, { headers: { "content-type": "application/json" } });
}

// The first id in the anime fixture (Kimetsu no Yaiba) — used for the
// already-added test.
const FIXTURE_FIRST_ID = String(
  (searchAnimeFixture as { data: { Page: { media: { id: number }[] } } }).data
    .Page.media[0]!.id,
);

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(async () => {
  await env.DB.exec("DELETE FROM media");
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe("GET /api/anilist/search — validation", () => {
  it("returns 400 when q is missing", async () => {
    const res = await search("type=ANIME");
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid type", async () => {
    const res = await search("q=demon&type=BOOK");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/anilist/search — results", () => {
  it("returns AniList results for a valid query", async () => {
    mockSearch();
    const res = await search("q=kimetsu&type=ANIME");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      results: { id: number; title: { romaji: string }; alreadyAdded: boolean }[];
    };
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]!.title.romaji).toBeTruthy();
  });

  it("marks alreadyAdded=false when nothing is in the library", async () => {
    mockSearch();
    const res = await search("q=kimetsu&type=ANIME");
    const body = (await res.json()) as { results: { alreadyAdded: boolean }[] };
    expect(body.results.every((r) => r.alreadyAdded === false)).toBe(true);
  });

  it("marks alreadyAdded=true for a result already in the library", async () => {
    // Seed the first fixture result as already added.
    const seeded: AniListMapperResult = {
      type: "animation",
      region: "japan",
      title_native: "x",
      title_romaji: "x",
      title_english: "x",
      title_chinese: null,
      status: "planned",
      is_rewatching: 0,
      cover_url: null,
      external_id: FIXTURE_FIRST_ID,
      external_source: "anilist",
      current_episode: null,
      total_episodes: null,
      current_chapter: null,
      total_chapters: null,
    };
    await insertMedia(env.DB, seeded);

    mockSearch();
    const res = await search("q=kimetsu&type=ANIME");
    const body = (await res.json()) as {
      results: { id: number; alreadyAdded: boolean }[];
    };

    const seededResult = body.results.find(
      (r) => String(r.id) === FIXTURE_FIRST_ID,
    );
    expect(seededResult?.alreadyAdded).toBe(true);
    // Other results remain not-added.
    expect(
      body.results.filter((r) => String(r.id) !== FIXTURE_FIRST_ID).every(
        (r) => r.alreadyAdded === false,
      ),
    ).toBe(true);
  });
});
