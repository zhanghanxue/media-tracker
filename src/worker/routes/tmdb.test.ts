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
