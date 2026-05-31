import { describe, expect, it } from "vitest";

import { tmdbToMediaRow, tmdbSeasonToMediaRow } from "./tmdb-mapper";
import type { TmdbDetail, TmdbSeasonDetail } from "./tmdb";

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

  it("derives release_date from release_date", () => {
    expect(row.release_date).toBe("2019-05-30");
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

  it("derives release_date from first_air_date", () => {
    expect(row.release_date).toBe("2021-09-17");
  });

  it("kind-prefixes the external id (tv namespace distinct from movie)", () => {
    expect(row.external_id).toBe("tv:93405");
  });
});

describe("tmdbSeasonToMediaRow", () => {
  // 唐朝诡事录 (zh-origin) with season 2 "西行" / "To The West".
  const show: TmdbDetail = {
    id: 211089,
    original_name: "唐朝诡事录",
    original_language: "zh",
    origin_country: ["CN"],
    poster_path: "/show.jpg",
    translations: {
      translations: [
        { iso_639_1: "en", iso_3166_1: "US", data: { name: "Strange Tales of Tang Dynasty" } },
        { iso_639_1: "zh", iso_3166_1: "CN", data: { name: "唐朝诡事录" } },
      ],
    },
    seasons: [
      { season_number: 0, name: "特别篇", episode_count: 0 },
      { season_number: 1, name: "第 1 季", episode_count: 36, poster_path: "/s1.jpg" },
      { season_number: 2, name: "西行", episode_count: 40, poster_path: "/s2.jpg", air_date: "2024-07-22" },
    ],
  };
  const season2: TmdbSeasonDetail = {
    id: 999,
    season_number: 2,
    name: "To The West",
    poster_path: "/s2.jpg",
    translations: {
      translations: [
        { iso_639_1: "en", iso_3166_1: "US", data: { name: "To The West" } },
        { iso_639_1: "zh", iso_3166_1: "CN", data: { name: "西行" } },
      ],
    },
  };
  const summary = show.seasons!.find((s) => s.season_number === 2)!;
  const row = tmdbSeasonToMediaRow(show, summary, season2, "in_progress");

  it("composes {show} {season} per language and maps to drama", () => {
    expect(row.type).toBe("drama");
    expect(row.title_chinese).toBe("唐朝诡事录 西行");
    expect(row.title_english).toBe("Strange Tales of Tang Dynasty To The West");
    expect(row.title_native).toBe("唐朝诡事录 西行"); // native = zh (show original_language)
  });

  it("pre-links into the show's collection with the season as sort_order", () => {
    expect(row.collection_id).toBe("tmdb:tv:211089");
    expect(row.sort_order).toBe(2);
    expect(row.external_id).toBe("tv:211089:s2");
  });

  it("takes episode count + poster + region from the season/show", () => {
    expect(row.total_episodes).toBe(40);
    expect(row.cover_url).toBe("https://image.tmdb.org/t/p/w500/s2.jpg");
    expect(row.region).toBe("china");
  });

  it("derives release_date from the season's air_date", () => {
    expect(row.release_date).toBe("2024-07-22");
  });

  it("falls back to the summary name when the season fetch is null", () => {
    const r = tmdbSeasonToMediaRow(show, summary, null, "planned");
    // No season translations → uses summary.name "西行" for every language slot.
    expect(r.title_chinese).toBe("唐朝诡事录 西行");
    expect(r.sort_order).toBe(2);
  });
});

describe("tmdbToMediaRow — origin-language poster", () => {
  it("picks the poster whose language matches the origin (over a higher-voted en one)", () => {
    const detail: TmdbDetail = {
      id: 1,
      original_title: "x",
      original_language: "zh",
      poster_path: "/default.jpg",
      images: {
        posters: [
          { file_path: "/en.jpg", iso_639_1: "en", vote_average: 9 },
          { file_path: "/zh-low.jpg", iso_639_1: "zh", vote_average: 5 },
          { file_path: "/zh-high.jpg", iso_639_1: "zh", vote_average: 8 },
        ],
      },
    };
    const row = tmdbToMediaRow(detail, "movie", "planned");
    expect(row.cover_url).toBe("https://image.tmdb.org/t/p/w500/zh-high.jpg");
  });

  it("falls back to the default poster when no origin-language poster exists", () => {
    const detail: TmdbDetail = {
      id: 2,
      original_title: "x",
      original_language: "th",
      poster_path: "/default.jpg",
      images: { posters: [{ file_path: "/en.jpg", iso_639_1: "en" }] },
    };
    const row = tmdbToMediaRow(detail, "movie", "planned");
    expect(row.cover_url).toBe("https://image.tmdb.org/t/p/w500/default.jpg");
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

  it("falls back to the base title when there's no `en` translation (English-origin)", () => {
    // An English-origin movie: TMDB lists no separate `en` translation, but the
    // en-US fetch puts the English title in the base `title` field.
    const noEn: TmdbDetail = {
      id: 27205,
      title: "Inception",
      original_title: "Inception",
      translations: { translations: [] },
    };
    const row = tmdbToMediaRow(noEn, "movie", "planned");
    expect(row.title_english).toBe("Inception");
  });

  it("uses the base name for a tv show lacking an `en` translation", () => {
    const noEnTv: TmdbDetail = {
      id: 1396,
      name: "Breaking Bad",
      original_name: "Breaking Bad",
    };
    const row = tmdbToMediaRow(noEnTv, "tv", "planned");
    expect(row.title_english).toBe("Breaking Bad");
  });
});
