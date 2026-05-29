import { describe, expect, it } from "vitest";

import { tmdbToMediaRow } from "./tmdb-mapper";
import type { TmdbDetail } from "./tmdb";

import detailMovieFixture from "../../../test/fixtures/tmdb/detail_movie_496243.json";
import detailTvFixture from "../../../test/fixtures/tmdb/detail_tv_93405.json";

const movie = detailMovieFixture as TmdbDetail;
const tv = detailTvFixture as TmdbDetail;

describe("tmdbToMediaRow — movie", () => {
  const row = tmdbToMediaRow(movie, "movie", "completed");

  it("maps a movie to type 'movie'", () => {
    expect(row.type).toBe("movie");
  });

  it("uses original_title as native and mines en/zh translations", () => {
    expect(row.title_native).toBe("기생충");
    expect(row.title_english).toBe("Parasite");
    expect(row.title_chinese).toBe("寄生虫"); // zh-CN (Simplified), not the zh-TW "寄生上流"
  });

  it("leaves romaji null (TMDB has no romaji)", () => {
    expect(row.title_romaji).toBeNull();
  });

  it("derives region from origin_country / production_countries", () => {
    expect(row.region).toBe("korea");
  });

  it("stores runtime and no episode/chapter counts", () => {
    expect(row.runtime_minutes).toBe(133);
    expect(row.total_episodes).toBeNull();
    expect(row.total_chapters).toBeNull();
  });

  it("kind-prefixes the external id and tags the source", () => {
    expect(row.external_id).toBe("movie:496243");
    expect(row.external_source).toBe("tmdb");
  });

  it("builds a poster cover URL", () => {
    expect(row.cover_url).toBe(
      "https://image.tmdb.org/t/p/w500/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg",
    );
  });

  it("carries the caller-supplied status", () => {
    expect(row.status).toBe("completed");
  });
});

describe("tmdbToMediaRow — tv", () => {
  const row = tmdbToMediaRow(tv, "tv", "in_progress");

  it("maps a tv series to type 'drama'", () => {
    expect(row.type).toBe("drama");
  });

  it("uses original_name as native and mines en/zh translations", () => {
    expect(row.title_native).toBe("오징어 게임");
    expect(row.title_english).toBe("Squid Game");
    expect(row.title_chinese).toBe("鱿鱼游戏");
  });

  it("stores number_of_episodes as total_episodes", () => {
    expect(row.total_episodes).toBe(9);
  });

  it("derives region from origin_country", () => {
    expect(row.region).toBe("korea");
  });

  it("kind-prefixes the external id (tv namespace distinct from movie)", () => {
    expect(row.external_id).toBe("tv:93405");
  });
});

describe("tmdbToMediaRow — edge cases", () => {
  it("returns null titles/region when the detail is sparse", () => {
    const sparse: TmdbDetail = { id: 42, original_title: "" };
    const row = tmdbToMediaRow(sparse, "movie", "planned");
    expect(row.title_native).toBeNull(); // empty string → null
    expect(row.title_english).toBeNull();
    expect(row.title_chinese).toBeNull();
    expect(row.region).toBeNull();
    expect(row.runtime_minutes).toBeNull();
    expect(row.cover_url).toBeNull();
  });

  it("falls back to the first zh translation when no CN variant exists", () => {
    const twOnly: TmdbDetail = {
      id: 7,
      original_title: "x",
      translations: {
        translations: [
          { iso_639_1: "zh", iso_3166_1: "TW", data: { title: "繁體標題" } },
        ],
      },
    };
    const row = tmdbToMediaRow(twOnly, "movie", "planned");
    expect(row.title_chinese).toBe("繁體標題");
  });
});
