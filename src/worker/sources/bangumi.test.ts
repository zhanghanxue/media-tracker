import { describe, expect, it, vi } from "vitest";

import {
  BangumiError,
  getBangumiSubject,
  searchBangumiLegacy,
  searchBangumiV0,
} from "./bangumi";

import searchAnimeFixture from "../../../test/fixtures/bangumi/search_anime_kimetsu.json";
import detailAnimeFixture from "../../../test/fixtures/bangumi/detail_anime_245665.json";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("searchBangumiV0", () => {
  it("POSTs keyword + type filter and returns the `data` array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        total: 1,
        data: [{ id: 245665, type: 2, name: "鬼滅の刃", name_cn: "鬼灭之刃" }],
      }),
    );

    const results = await searchBangumiV0("Kimetsu no Yaiba", 2, {
      fetch: fetchMock,
      max: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(245665);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.bgm.tv/v0/search/subjects?limit=5");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      keyword: "Kimetsu no Yaiba",
      filter: { type: [2] },
    });
  });

  it("returns [] when v0 finds nothing (empty data)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ total: 0, data: [] }));

    expect(await searchBangumiV0("zzz", 2, { fetch: fetchMock })).toEqual([]);
  });

  it("throws BangumiError on a non-404 failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("oops", { status: 500 }));

    await expect(
      searchBangumiV0("x", 2, { fetch: fetchMock }),
    ).rejects.toThrow(BangumiError);
  });
});

describe("searchBangumiLegacy", () => {
  it("returns the `list` array from the captured search fixture", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(searchAnimeFixture));

    const results = await searchBangumiLegacy("鬼滅の刃", 2, { fetch: fetchMock });

    expect(results.length).toBe(searchAnimeFixture.list.length);
    expect(results[0]!.id).toBe(245665);
    expect(results[0]!.name_cn).toContain("鬼灭之刃");
  });

  it("builds the legacy search URL with the encoded keyword, type and max", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(searchAnimeFixture));

    await searchBangumiLegacy("鬼滅の刃", 2, { fetch: fetchMock, max: 5 });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("https://api.bgm.tv/search/subject/");
    expect(url).toContain(encodeURIComponent("鬼滅の刃"));
    expect(url).toContain("type=2");
    expect(url).toContain("max_results=5");
    expect(url).toContain("responseGroup=large");
  });

  it("returns [] on a 404 (Bangumi's no-match quirk, not an error)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Not Found", { status: 404 }));

    const results = await searchBangumiLegacy("zzzznomatch", 2, {
      fetch: fetchMock,
    });
    expect(results).toEqual([]);
  });

  it("returns [] on a 200 error-shaped body (code/error, no list)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: 404, error: "Not Found" }));

    const results = await searchBangumiLegacy("zzzz", 2, { fetch: fetchMock });
    expect(results).toEqual([]);
  });

  it("throws BangumiError on a non-404 failure (e.g. 500)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("oops", { status: 500 }));

    await expect(
      searchBangumiLegacy("x", 2, { fetch: fetchMock }),
    ).rejects.toThrow(BangumiError);
  });
});

describe("getBangumiSubject", () => {
  it("returns the full subject from the captured detail fixture", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(detailAnimeFixture));

    const subject = await getBangumiSubject(245665, { fetch: fetchMock });

    expect(subject).not.toBeNull();
    expect(subject!.id).toBe(245665);
    expect(subject!.type).toBe(2);
    expect(subject!.platform).toBe("TV");
    expect(subject!.eps).toBe(26);
  });

  it("hits the v0 subject endpoint by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(detailAnimeFixture));

    await getBangumiSubject(245665, { fetch: fetchMock });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.bgm.tv/v0/subjects/245665");
  });

  it("returns null when the id doesn't exist (404)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Not Found", { status: 404 }));

    const subject = await getBangumiSubject(999999999, { fetch: fetchMock });
    expect(subject).toBeNull();
  });

  it("throws BangumiError on a non-404 failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("oops", { status: 500 }));

    await expect(
      getBangumiSubject(1, { fetch: fetchMock }),
    ).rejects.toThrow(BangumiError);
  });
});
