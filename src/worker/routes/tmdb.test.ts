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

describe("GET /api/tmdb/collection/:id", () => {
  it("returns the franchise's parts, with the （系列） marker off the name", async () => {
    const collectionResp = {
      id: 1241,
      name: "哈利·波特（系列）",
      parts: [
        {
          id: 671,
          title: "哈利·波特与魔法石",
          release_date: "2001-11-16",
          poster_path: "/p1.jpg",
          vote_average: 7.9,
        },
        // No poster / date / score: the route must still emit the row, nulled.
        { id: 672, title: "哈利·波特与密室" },
      ],
    };
    fetchMock
      .get(TMDB_API_ORIGIN)
      .intercept({ method: "GET", path: /^\/3\/collection\/1241/ })
      .reply(200, JSON.stringify(collectionResp), {
        headers: { "content-type": "application/json" },
      });

    const res = await app.request("/api/tmdb/collection/1241", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      name: string | null;
      parts: { id: number; title: string | null; poster_path: string | null }[];
    };
    expect(body.name).toBe("哈利·波特");
    expect(body.parts.map((p) => p.id)).toEqual([671, 672]);
    expect(body.parts[1]!.poster_path).toBeNull();
  });

  it("404s when TMDB has no such collection", async () => {
    fetchMock
      .get(TMDB_API_ORIGIN)
      .intercept({ method: "GET", path: /^\/3\/collection\/999999/ })
      .reply(404, JSON.stringify({ status_code: 34 }), {
        headers: { "content-type": "application/json" },
      });

    const res = await app.request("/api/tmdb/collection/999999", {}, env);
    expect(res.status).toBe(404);
  });

  it("400s on a non-numeric id", async () => {
    const res = await app.request("/api/tmdb/collection/abc", {}, env);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tmdb/existing", () => {
  it("reports which TMDB ids the library already tracks", async () => {
    await env.DB.prepare(
      `INSERT INTO media (type, title_english, status, external_source, external_id)
       VALUES ('movie', 'Tracked', 'planned', 'tmdb', 'movie:671')`,
    ).run();

    const res = await app.request(
      "/api/tmdb/existing?ids=movie:671,movie:672",
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { existing: string[] };
    expect(body.existing).toEqual(["movie:671"]);
  });

  it("returns nothing for an empty id list, without touching TMDB", async () => {
    const res = await app.request("/api/tmdb/existing?ids=", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ existing: [] });
  });
});
