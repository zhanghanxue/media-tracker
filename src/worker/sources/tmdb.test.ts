import { describe, expect, it, vi } from "vitest";

import {
  TmdbError,
  getTmdbDetail,
  searchTmdb,
  tmdbPosterUrl,
} from "./tmdb";

import searchMovieFixture from "../../../test/fixtures/tmdb/search_movie_parasite.json";
import searchTvFixture from "../../../test/fixtures/tmdb/search_tv_squid.json";
import detailMovieFixture from "../../../test/fixtures/tmdb/detail_movie_496243.json";
import detailTvFixture from "../../../test/fixtures/tmdb/detail_tv_93405.json";

const API_KEY = "test-bearer-token";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("searchTmdb", () => {
  it("returns the results array from the captured MOVIE fixture", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(searchMovieFixture));

    const results = await searchTmdb("寄生虫", "movie", {
      apiKey: API_KEY,
      fetch: fetchMock,
    });

    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe(496243);
    expect(results[0]!.title).toBe("寄生虫");
    expect(results[0]!.original_title).toBe("기생충");
  });

  it("returns the results array from the captured TV fixture", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(searchTvFixture));

    const results = await searchTmdb("鱿鱼游戏", "tv", {
      apiKey: API_KEY,
      fetch: fetchMock,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(93405);
    expect(results[0]!.name).toBe("鱿鱼游戏");
  });

  it("hits the right endpoint with a Bearer header and zh-CN language", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(searchMovieFixture));

    await searchTmdb("寄生虫", "movie", { apiKey: API_KEY, fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("https://api.themoviedb.org/3/search/movie");
    expect(url).toContain("query=%E5%AF%84%E7%94%9F%E8%99%AB");
    expect(url).toContain("language=zh-CN");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it("returns [] when the response has no results field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ page: 1 }));

    const results = await searchTmdb("x", "movie", {
      apiKey: API_KEY,
      fetch: fetchMock,
    });

    expect(results).toEqual([]);
  });
});

describe("getTmdbDetail", () => {
  it("returns the MOVIE detail with appended translations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(detailMovieFixture));

    const detail = await getTmdbDetail(496243, "movie", {
      apiKey: API_KEY,
      fetch: fetchMock,
    });

    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(496243);
    expect(detail!.runtime).toBe(133);
    expect(detail!.translations!.translations.length).toBeGreaterThan(0);

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/movie/496243");
    expect(url).toContain("append_to_response=translations");
  });

  it("returns the TV detail from the captured fixture", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(detailTvFixture));

    const detail = await getTmdbDetail(93405, "tv", {
      apiKey: API_KEY,
      fetch: fetchMock,
    });

    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(93405);
    expect(detail!.number_of_episodes).toBe(9);
    expect(detail!.origin_country).toEqual(["KR"]);
  });

  it("returns null on HTTP 404 (unknown id)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("not found", { status: 404 }));

    const detail = await getTmdbDetail(999999999, "movie", {
      apiKey: API_KEY,
      fetch: fetchMock,
    });

    expect(detail).toBeNull();
  });
});

describe("TMDB rate-limit retry", () => {
  it("retries on HTTP 429 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse(searchMovieFixture));

    const results = await searchTmdb("x", "movie", {
      apiKey: API_KEY,
      fetch: fetchMock,
      backoffMs: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0]!.id).toBe(496243);
  });

  it("throws TmdbError once the retry budget is exhausted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("rate limited", { status: 429 }));

    await expect(
      searchTmdb("x", "movie", {
        apiKey: API_KEY,
        fetch: fetchMock,
        backoffMs: 0,
        retries: 1,
      }),
    ).rejects.toThrow(TmdbError);

    // initial + 1 retry
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on a 500", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("oops", { status: 500 }));

    await expect(
      searchTmdb("x", "movie", { apiKey: API_KEY, fetch: fetchMock, backoffMs: 0 }),
    ).rejects.toThrow(/HTTP 500/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("tmdbPosterUrl", () => {
  it("builds a w500 URL from a poster_path", () => {
    expect(tmdbPosterUrl("/abc.jpg")).toBe(
      "https://image.tmdb.org/t/p/w500/abc.jpg",
    );
  });

  it("returns null for a null/empty path", () => {
    expect(tmdbPosterUrl(null)).toBeNull();
    expect(tmdbPosterUrl(undefined)).toBeNull();
  });
});
