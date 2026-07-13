import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getIgdbDetail,
  getIgdbSimilarGames,
  igdbCoverUrl,
  resetIgdbTokenCache,
  searchIgdb,
  type IgdbGame,
} from "./igdb";

const CREDS = { clientId: "cid", clientSecret: "sec" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const tokenResponse = () =>
  jsonResponse({ access_token: "tok", expires_in: 3600 });

// Route the mocked fetch by URL: Twitch token vs IGDB games endpoint.
function makeFetch(games: IgdbGame[] | (() => Response)) {
  return vi.fn(
    async (
      input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      if (String(input).includes("id.twitch.tv")) return tokenResponse();
      return typeof games === "function" ? games() : jsonResponse(games);
    },
  );
}

beforeEach(() => {
  // The token cache is module-global; clear it so each test mints fresh.
  resetIgdbTokenCache();
});

describe("searchIgdb", () => {
  it("mints a Twitch token, then queries IGDB with the right headers + body", async () => {
    const fetchMock = makeFetch([{ id: 1, name: "The Legend of Zelda" }]);

    const results = await searchIgdb("zelda", { ...CREDS, fetch: fetchMock });

    expect(results[0]!.name).toBe("The Legend of Zelda");
    expect(fetchMock).toHaveBeenCalledTimes(2); // token + games

    const gamesCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("api.igdb.com"),
    )!;
    const init = gamesCall[1] as RequestInit & { headers: Record<string, string> };
    expect(init.method).toBe("POST");
    expect(init.headers["Client-ID"]).toBe("cid");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(String(init.body)).toContain('search "zelda"');
    expect(String(init.body)).toContain("cover.image_id");
  });

  it("escapes embedded quotes in the search query", async () => {
    const fetchMock = makeFetch([]);
    await searchIgdb('say "hi"', { ...CREDS, fetch: fetchMock });
    const gamesCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("api.igdb.com"),
    )!;
    expect(String((gamesCall[1] as RequestInit).body)).toContain(
      'search "say \\"hi\\""',
    );
  });

  it("caches the Twitch token across calls", async () => {
    const fetchMock = makeFetch([{ id: 1, name: "A" }]);
    await searchIgdb("a", { ...CREDS, fetch: fetchMock });
    await searchIgdb("b", { ...CREDS, fetch: fetchMock });

    const tokenCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("id.twitch.tv"),
    );
    expect(tokenCalls).toHaveLength(1); // one token, reused
  });
});

describe("getIgdbDetail", () => {
  it("returns the single game", async () => {
    const fetchMock = makeFetch([{ id: 1942, name: "The Witcher 3" }]);
    const game = await getIgdbDetail(1942, { ...CREDS, fetch: fetchMock });
    expect(game!.name).toBe("The Witcher 3");
  });

  it("returns null when IGDB returns an empty array (no such id)", async () => {
    const fetchMock = makeFetch([]);
    expect(await getIgdbDetail(999, { ...CREDS, fetch: fetchMock })).toBeNull();
  });
});

describe("getIgdbSimilarGames", () => {
  it("expands similar_games and requests alternative_names (for Chinese display titles)", async () => {
    const fetchMock = makeFetch([
      {
        id: 1942,
        name: "The Witcher 3",
        similar_games: [
          {
            id: 119171,
            name: "Wandering Sword",
            alternative_names: [{ name: "逸剑风云决" }],
          },
        ],
      } as IgdbGame,
    ]);

    const similar = await getIgdbSimilarGames(1942, { ...CREDS, fetch: fetchMock });

    expect(similar).toHaveLength(1);
    expect(similar[0]!.alternative_names?.[0]?.name).toBe("逸剑风云决");

    const gamesCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("api.igdb.com"),
    )!;
    expect(String((gamesCall[1] as RequestInit).body)).toContain(
      "similar_games.alternative_names.name",
    );
  });

  it("returns [] when the game has no similar_games / isn't found", async () => {
    const fetchMock = makeFetch([]);
    expect(await getIgdbSimilarGames(1, { ...CREDS, fetch: fetchMock })).toEqual([]);
  });
});

describe("igdbCoverUrl", () => {
  it("builds a t_cover_big URL from an image id", () => {
    expect(igdbCoverUrl("co1wyy")).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co1wyy.jpg",
    );
  });
  it("returns null for a missing image id", () => {
    expect(igdbCoverUrl(null)).toBeNull();
    expect(igdbCoverUrl(undefined)).toBeNull();
  });
});
