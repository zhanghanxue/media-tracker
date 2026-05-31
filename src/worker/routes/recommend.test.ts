// Integration tests for GET /api/recommendations via vitest-pool-workers. Real D1
// (seeds + library-exclusion) with the outbound TMDB / IGDB calls mocked. anime is
// NOT tested here — it's browser-side (no Worker route).

import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import app from "../index";
import { insertMedia } from "../db/media-repository";
import type { MediaInsert } from "../db/schema";

const TMDB_API_ORIGIN = "https://api.themoviedb.org";

function movieRow(over: Partial<MediaInsert>): MediaInsert {
  return {
    type: "movie",
    region: "japan",
    title_native: null,
    title_romaji: null,
    title_english: "Seed Movie",
    title_chinese: null,
    status: "completed",
    is_rewatching: 0,
    cover_url: null,
    external_id: "movie:100",
    external_source: "tmdb",
    current_episode: null,
    total_episodes: null,
    current_chapter: null,
    total_chapters: null,
    runtime_minutes: null,
    release_date: null,
    source_rating: null,
    genres: null,
    platform: null,
    consumption_mode: null,
    collection_id: null,
    sort_order: null,
    ...over,
  };
}

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

describe("GET /api/recommendations — validation", () => {
  it("400s on a missing/invalid type", async () => {
    expect((await app.request("/api/recommendations", {}, env)).status).toBe(400);
    expect((await app.request("/api/recommendations?type=manga", {}, env)).status).toBe(400);
  });

  it("400s on animation (that path is browser-side, not served here)", async () => {
    const res = await app.request("/api/recommendations?type=animation", {}, env);
    expect(res.status).toBe(400);
  });

  it("returns an empty list (no source call) when there are no seeds", async () => {
    // No interceptor → a TMDB call would throw on disableNetConnect.
    const res = await app.request("/api/recommendations?type=movie", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recommendations: unknown[] };
    expect(body.recommendations).toEqual([]);
  });
});

describe("GET /api/recommendations — movie (TMDB)", () => {
  it("fans out per seed, excludes owned + dedups, attributes the why", async () => {
    // Library: one completed seed movie (id 100), plus movie 603 already owned but
    // `planned` so it's NOT a seed (only completed/in_progress seed) — it should
    // still be excluded from results though.
    await insertMedia(env.DB, movieRow({ external_id: "movie:100", title_english: "Seed" }));
    await insertMedia(
      env.DB,
      movieRow({ external_id: "movie:603", title_english: "Owned", status: "planned" }),
    );

    // TMDB recommends 603 (owned → excluded) + 777 (new). 777 should survive.
    const recsResp = {
      results: [
        { id: 603, title: "Owned", poster_path: "/o.jpg", vote_average: 8.1 },
        { id: 777, title: "Fresh Pick", poster_path: "/f.jpg", vote_average: 7.3 },
      ],
    };
    fetchMock
      .get(TMDB_API_ORIGIN)
      .intercept({ method: "GET", path: /^\/3\/movie\/100\/recommendations/ })
      .reply(200, JSON.stringify(recsResp), {
        headers: { "content-type": "application/json" },
      });

    const res = await app.request("/api/recommendations?type=movie", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recommendations: { id: string; title: string; becauseTitle: string }[];
    };
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0]!.id).toBe("movie:777");
    expect(body.recommendations[0]!.title).toBe("Fresh Pick");
    expect(body.recommendations[0]!.becauseTitle).toBe("Seed");
  });
});
