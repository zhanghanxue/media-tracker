import { describe, expect, it, vi } from "vitest";

import {
  AniListError,
  getAniListDetail,
  getAniListRelations,
  searchAniList,
} from "./anilist";

import searchAnimeFixture from "../../../test/fixtures/anilist/search_anime_kimetsu.json";
import searchMangaFixture from "../../../test/fixtures/anilist/search_manga_kimetsu.json";
import detailAnimeFixture from "../../../test/fixtures/anilist/detail_anime_101922.json";
import detailMangaFixture from "../../../test/fixtures/anilist/detail_manga_87216.json";

const ANILIST_ENDPOINT = "https://graphql.anilist.co";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("searchAniList", () => {
  it("returns the parsed media array from the captured ANIME fixture", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(searchAnimeFixture));

    const results = await searchAniList("Kimetsu no Yaiba", "ANIME", {
      fetch: fetchMock,
    });

    expect(results).toHaveLength(5);
    expect(results[0]!.id).toBe(101922);
    expect(results[0]!.title.romaji).toBe("Kimetsu no Yaiba");
    expect(results[0]!.format).toBe("TV");
    expect(results[0]!.countryOfOrigin).toBe("JP");
  });

  it("returns the parsed media array from the captured MANGA fixture", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(searchMangaFixture));

    const results = await searchAniList("Kimetsu no Yaiba", "MANGA", {
      fetch: fetchMock,
    });

    expect(results.length).toBeGreaterThan(0);
    // The manga search fixture should contain at least one MANGA-format result.
    expect(results.some((m) => m.format === "MANGA")).toBe(true);
  });

  it("POSTs JSON to the AniList GraphQL endpoint with query + variables", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(searchAnimeFixture));

    await searchAniList("Demon Slayer", "ANIME", {
      fetch: fetchMock,
      perPage: 7,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ANILIST_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body);
    expect(body.variables).toEqual({
      search: "Demon Slayer",
      type: "ANIME",
      perPage: 7,
    });
    // The query string is hand-written; assert it asks for the fields the mapper relies on.
    expect(body.query).toMatch(/Page\(perPage:\s*\$perPage\)/);
    expect(body.query).toMatch(/media\(search:\s*\$search,\s*type:\s*\$type\)/);
    expect(body.query).toContain("countryOfOrigin");
    expect(body.query).toContain("coverImage");
    expect(body.query).toContain("format");
  });

  it("defaults perPage to 10 when not specified", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(searchAnimeFixture));

    await searchAniList("x", "ANIME", { fetch: fetchMock });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.variables.perPage).toBe(10);
  });
});

describe("getAniListDetail", () => {
  it("returns the single Media object from the captured ANIME detail fixture", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(detailAnimeFixture));

    const detail = await getAniListDetail(101922, "ANIME", { fetch: fetchMock });

    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(101922);
    expect(detail!.episodes).toBe(26);
    expect(detail!.format).toBe("TV");
  });

  it("returns the single Media object from the captured MANGA detail fixture", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(detailMangaFixture));

    const detail = await getAniListDetail(87216, "MANGA", { fetch: fetchMock });

    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(87216);
    expect(detail!.chapters).toBe(207);
    expect(detail!.format).toBe("MANGA");
  });

  it("returns null when AniList responds with Media:null (id not found, no errors block)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { Media: null } }));

    const detail = await getAniListDetail(999999999, "ANIME", {
      fetch: fetchMock,
    });

    expect(detail).toBeNull();
  });

  it("sends id + type as GraphQL variables", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(detailAnimeFixture));

    await getAniListDetail(101922, "ANIME", { fetch: fetchMock });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.variables).toEqual({ id: 101922, type: "ANIME" });
    expect(body.query).toMatch(/Media\(id:\s*\$id,\s*type:\s*\$type\)/);
  });
});

describe("getAniListRelations", () => {
  // Trimmed shape mirroring the live probe of Attack on Titan (id 16498).
  const relationsResponse = {
    data: {
      Media: {
        relations: {
          edges: [
            { relationType: "SEQUEL", node: { id: 20958, type: "ANIME", format: "TV" } },
            { relationType: "ADAPTATION", node: { id: 53390, type: "MANGA", format: "MANGA" } },
            { relationType: "PREQUEL", node: { id: 20811, type: "ANIME", format: "OVA" } },
          ],
        },
      },
    },
  };

  it("returns the relation edges and sends id as the only variable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(relationsResponse));

    const edges = await getAniListRelations(16498, { fetch: fetchMock });

    expect(edges).toHaveLength(3);
    expect(edges[0]).toEqual({
      relationType: "SEQUEL",
      node: { id: 20958, type: "ANIME", format: "TV" },
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.variables).toEqual({ id: 16498 });
    expect(body.query).toContain("relations");
  });

  it("returns [] when the Media has no relations / is null", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { Media: null } }));

    expect(await getAniListRelations(1, { fetch: fetchMock })).toEqual([]);
  });
});

describe("AniList rate-limit retry", () => {
  it("retries on HTTP 429 and succeeds on the next attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse(searchAnimeFixture));

    const results = await searchAniList("x", "ANIME", {
      fetch: fetchMock,
      backoffMs: 0, // skip the wait in tests
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0]!.id).toBe(101922);
  });

  it("throws AniListError once retry budget is exhausted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("rate limited", { status: 429 }));

    await expect(
      searchAniList("x", "ANIME", {
        fetch: fetchMock,
        backoffMs: 0,
        retries: 2,
      }),
    ).rejects.toThrow(AniListError);

    // Initial attempt + 2 retries = 3 calls.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on non-429 errors (e.g. 500)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("oops", { status: 500 }));

    await expect(
      searchAniList("x", "ANIME", { fetch: fetchMock, backoffMs: 0 }),
    ).rejects.toThrow(/HTTP 500/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors the Retry-After header (in seconds) when present", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "0.01" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(searchAnimeFixture));

    const start = Date.now();
    await searchAniList("x", "ANIME", { fetch: fetchMock, backoffMs: 0 });
    const elapsed = Date.now() - start;

    // 0.01s = 10ms; allow plenty of slack but verify we waited *something*.
    expect(elapsed).toBeGreaterThanOrEqual(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("AniList GraphQL error surfacing", () => {
  it("throws AniListError when the response body contains an `errors` array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: null,
        errors: [{ message: "No query or mutation provided.", status: 400 }],
      }),
    );

    await expect(
      searchAniList("x", "ANIME", { fetch: fetchMock }),
    ).rejects.toThrow(/No query or mutation provided/);
  });
});
