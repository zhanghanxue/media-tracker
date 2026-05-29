// Integration tests for GET /api/tmdb/search via vitest-pool-workers. The Worker
// proxies TMDB (key-bearing), so the outbound TMDB call is mocked with fetchMock.
// TMDB_API_KEY is provided as a test binding (vitest.workers.config.ts).

import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import app from "../index";
import searchMovieFixture from "../../../test/fixtures/tmdb/search_movie_parasite.json";

const TMDB_API_ORIGIN = "https://api.themoviedb.org";

async function search(qs: string): Promise<Response> {
  return app.request(`/api/tmdb/search?${qs}`, {}, env);
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe("GET /api/tmdb/search", () => {
  it("proxies a movie search and returns the results array", async () => {
    fetchMock
      .get(TMDB_API_ORIGIN)
      .intercept({ method: "GET", path: /^\/3\/search\/movie/ })
      .reply(200, JSON.stringify(searchMovieFixture), {
        headers: { "content-type": "application/json" },
      });

    const res = await search("q=%E5%AF%84%E7%94%9F%E8%99%AB&kind=movie");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { id: number }[] };
    expect(body.results).toHaveLength(2);
    expect(body.results[0]!.id).toBe(496243);
  });

  it("returns an empty result set for a blank query without calling TMDB", async () => {
    // No interceptor registered → if the handler called TMDB it would throw on
    // disableNetConnect, failing the test.
    const res = await search("q=%20%20&kind=movie");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it("400s on a bad kind", async () => {
    const res = await search("q=x&kind=banana");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tmdb/tv/:id/seasons", () => {
  it("returns real seasons (excludes the specials bucket / season 0)", async () => {
    const showResp = {
      id: 211089,
      seasons: [
        { season_number: 0, name: "特别篇", episode_count: 0 },
        { season_number: 1, name: "第 1 季", episode_count: 36, air_date: "2022-09-27", poster_path: "/s1.jpg" },
        { season_number: 2, name: "西行", episode_count: 40, air_date: "2024-07-18", poster_path: "/s2.jpg" },
      ],
    };
    fetchMock
      .get(TMDB_API_ORIGIN)
      .intercept({ method: "GET", path: /^\/3\/tv\/211089/ })
      .reply(200, JSON.stringify(showResp), {
        headers: { "content-type": "application/json" },
      });

    const res = await app.request("/api/tmdb/tv/211089/seasons", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seasons: { season_number: number }[] };
    expect(body.seasons.map((s) => s.season_number)).toEqual([1, 2]);
  });

  it("400s on a non-numeric id", async () => {
    const res = await app.request("/api/tmdb/tv/abc/seasons", {}, env);
    expect(res.status).toBe(400);
  });
});
