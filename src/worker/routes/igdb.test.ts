// Integration tests for the IGDB Worker routes via vitest-pool-workers. IGDB is
// key-bearing and behind a Twitch client-credentials token, so BOTH upstreams
// are mocked with fetchMock: the token endpoint and api.igdb.com itself.
// TWITCH_CLIENT_ID / _SECRET are provided as test bindings
// (vitest.workers.config.ts).

import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import app from "../index";

const TWITCH_ORIGIN = "https://id.twitch.tv";
const IGDB_ORIGIN = "https://api.igdb.com";

/** Queue one POST /v4/games response (the single endpoint the client uses). */
function mockIgdbGames(body: unknown) {
  fetchMock
    .get(IGDB_ORIGIN)
    .intercept({ method: "POST", path: "/v4/games" })
    .reply(200, JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  // The Twitch token is cached module-level by the igdb client, so only the
  // FIRST test that reaches IGDB actually fetches one. Persist it rather than
  // queueing per test, so the cache — not the test order — decides.
  fetchMock
    .get(TWITCH_ORIGIN)
    .intercept({ method: "POST", path: /^\/oauth2\/token/ })
    .reply(
      200,
      JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
      { headers: { "content-type": "application/json" } },
    )
    .persist();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe("GET /api/igdb/series", () => {
  it("flattens the games' series into a deduped list", async () => {
    mockIgdbGames([
      { id: 1020, name: "GTA V", collections: [{ id: 42, name: "Grand Theft Auto" }] },
      { id: 1021, name: "GTA IV", collections: [{ id: 42, name: "Grand Theft Auto" }] },
    ]);

    const res = await app.request("/api/igdb/series?ids=1020,1021", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { series: { id: number; name: string }[] };
    expect(body.series).toEqual([{ id: 42, name: "Grand Theft Auto" }]);
  });

  it("returns nothing for an empty id list, without calling IGDB", async () => {
    // No interceptor registered → a call would throw on disableNetConnect.
    const res = await app.request("/api/igdb/series?ids=", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ series: [] });
  });

  it("ignores non-numeric ids rather than passing them upstream", async () => {
    const res = await app.request("/api/igdb/series?ids=abc,0,-3", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ series: [] });
  });
});

describe("GET /api/igdb/series/:id/games", () => {
  it("drops re-packagings and editions, newest release first", async () => {
    mockIgdbGames([
      { id: 1, name: "Main (old)", game_type: 0, first_release_date: 100 },
      { id: 2, name: "Some DLC", game_type: 1, first_release_date: 300 },
      { id: 3, name: "Main (new)", game_type: 0, first_release_date: 200 },
      { id: 4, name: "GOTY Edition", game_type: 0, first_release_date: 400, version_parent: 1 },
    ]);

    const res = await app.request("/api/igdb/series/42/games", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { games: { id: number }[] };
    expect(body.games.map((g) => g.id)).toEqual([3, 1]);
  });

  it("400s on a non-numeric id", async () => {
    const res = await app.request("/api/igdb/series/abc/games", {}, env);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/igdb/existing", () => {
  it("reports which IGDB ids the library already tracks", async () => {
    await env.DB.prepare(
      `INSERT INTO media (type, title_english, status, external_source, external_id)
       VALUES ('game', 'Tracked', 'planned', 'igdb', '1020')`,
    ).run();

    const res = await app.request("/api/igdb/existing?ids=1020,1021", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { existing: string[] };
    expect(body.existing).toEqual(["1020"]);
  });

  it("returns nothing for an empty id list, without touching IGDB", async () => {
    const res = await app.request("/api/igdb/existing?ids=", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ existing: [] });
  });
});
