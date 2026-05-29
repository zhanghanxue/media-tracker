import { describe, expect, it } from "vitest";

import { aniListToMediaRow } from "./anilist-mapper";
import type { AniListMedia } from "./anilist";

import animeFixture from "../../../test/fixtures/anilist/detail_anime_101922.json";
import mangaFixture from "../../../test/fixtures/anilist/detail_manga_87216.json";
import novelSearchFixture from "../../../test/fixtures/anilist/search_novel_rezero.json";

const animeDetail = (animeFixture as { data: { Media: AniListMedia } }).data
  .Media;
const mangaDetail = (mangaFixture as { data: { Media: AniListMedia } }).data
  .Media;
const novelDetail = (
  novelSearchFixture as { data: { Page: { media: AniListMedia[] } } }
).data.Page.media[0]!;

describe("aniListToMediaRow — type discrimination", () => {
  it("maps an ANIME format (TV) to type='animation'", () => {
    const row = aniListToMediaRow(animeDetail, "in_progress");
    expect(row.type).toBe("animation");
  });

  it("maps MANGA format to type='manga'", () => {
    const row = aniListToMediaRow(mangaDetail, "in_progress");
    expect(row.type).toBe("manga");
  });

  it("maps NOVEL format to type='light_novel'", () => {
    const row = aniListToMediaRow(novelDetail, "planned");
    expect(row.type).toBe("light_novel");
  });

  it("maps anime MOVIE format to type='animation' (per PLAN.md: all non-MANGA/NOVEL formats are animation)", () => {
    const movieDetail: AniListMedia = { ...animeDetail, format: "MOVIE" };
    expect(aniListToMediaRow(movieDetail, "completed").type).toBe("animation");
  });

  it("maps ONE_SHOT format to type='manga' (one-shots are manga, not light novels)", () => {
    const oneShot: AniListMedia = { ...mangaDetail, format: "ONE_SHOT" };
    expect(aniListToMediaRow(oneShot, "completed").type).toBe("manga");
  });

  it("throws when format is null (we can't guess the type without it)", () => {
    const noFormat: AniListMedia = { ...animeDetail, format: null };
    expect(() => aniListToMediaRow(noFormat, "planned")).toThrow(/format/);
  });
});

describe("aniListToMediaRow — region from countryOfOrigin", () => {
  it("maps JP to japan", () => {
    expect(aniListToMediaRow(animeDetail, "planned").region).toBe("japan");
  });

  it.each([
    ["CN", "china"],
    ["KR", "korea"],
    ["TW", "taiwan"],
    ["HK", "hong_kong"],
    ["US", "usa"],
    ["GB", "uk"],
    ["TH", "thailand"],
  ])("maps %s to %s", (countryCode, expectedRegion) => {
    const detail: AniListMedia = {
      ...animeDetail,
      countryOfOrigin: countryCode,
    };
    expect(aniListToMediaRow(detail, "planned").region).toBe(expectedRegion);
  });

  it("falls back to lowercase ISO code for unknown countries (lossless)", () => {
    const detail: AniListMedia = { ...animeDetail, countryOfOrigin: "DE" };
    expect(aniListToMediaRow(detail, "planned").region).toBe("de");
  });

  it("returns region=null when countryOfOrigin is null", () => {
    const detail: AniListMedia = { ...animeDetail, countryOfOrigin: null };
    expect(aniListToMediaRow(detail, "planned").region).toBeNull();
  });
});

describe("aniListToMediaRow — titles", () => {
  it("copies all three AniList title variants into title_native / title_romaji / title_english", () => {
    const row = aniListToMediaRow(animeDetail, "in_progress");
    expect(row.title_native).toBe("鬼滅の刃");
    expect(row.title_romaji).toBe("Kimetsu no Yaiba");
    expect(row.title_english).toBe("Demon Slayer: Kimetsu no Yaiba");
  });

  it("leaves title_chinese=null (AniList doesn't ship Chinese; Bangumi enricher fills later)", () => {
    expect(aniListToMediaRow(animeDetail, "planned").title_chinese).toBeNull();
  });

  it("preserves null title fields without substituting", () => {
    const detail: AniListMedia = {
      ...animeDetail,
      title: { native: null, romaji: "Romaji only", english: null },
    };
    const row = aniListToMediaRow(detail, "planned");
    expect(row.title_native).toBeNull();
    expect(row.title_english).toBeNull();
    expect(row.title_romaji).toBe("Romaji only");
  });
});

describe("aniListToMediaRow — episode/chapter counts", () => {
  it("populates total_episodes only for animation (anime fixture has episodes=26)", () => {
    const row = aniListToMediaRow(animeDetail, "in_progress");
    expect(row.total_episodes).toBe(26);
    expect(row.total_chapters).toBeNull();
  });

  it("populates total_chapters only for manga (manga fixture has chapters=207)", () => {
    const row = aniListToMediaRow(mangaDetail, "completed");
    expect(row.total_chapters).toBe(207);
    expect(row.total_episodes).toBeNull();
  });

  it("for light_novel: uses chapters if present, falls back to volumes", () => {
    const withChapters: AniListMedia = {
      ...novelDetail,
      format: "NOVEL",
      chapters: 50,
      volumes: 10,
    };
    expect(aniListToMediaRow(withChapters, "planned").total_chapters).toBe(50);

    const volumesOnly: AniListMedia = {
      ...novelDetail,
      format: "NOVEL",
      chapters: null,
      volumes: 23,
    };
    expect(aniListToMediaRow(volumesOnly, "planned").total_chapters).toBe(23);
  });

  it("leaves current_episode and current_chapter null on a fresh row", () => {
    const row = aniListToMediaRow(animeDetail, "in_progress");
    expect(row.current_episode).toBeNull();
    expect(row.current_chapter).toBeNull();
  });
});

describe("aniListToMediaRow — passthrough fields", () => {
  it("passes the supplied status through verbatim", () => {
    expect(aniListToMediaRow(animeDetail, "planned").status).toBe("planned");
    expect(aniListToMediaRow(animeDetail, "dropped").status).toBe("dropped");
  });

  it("sets external_source='anilist'", () => {
    expect(aniListToMediaRow(animeDetail, "planned").external_source).toBe(
      "anilist",
    );
  });

  it("stringifies the numeric AniList id into external_id (column is TEXT)", () => {
    const row = aniListToMediaRow(animeDetail, "planned");
    expect(row.external_id).toBe("101922");
    expect(typeof row.external_id).toBe("string");
  });

  it("copies coverImage.extraLarge into cover_url (Phase 4 swaps for R2 URL post-upload)", () => {
    const row = aniListToMediaRow(animeDetail, "planned");
    expect(row.cover_url).toMatch(/^https:\/\/s4\.anilist\.co\/.+\.jpg$/);
  });

  it("sets is_rewatching=0 on a fresh row", () => {
    expect(aniListToMediaRow(animeDetail, "in_progress").is_rewatching).toBe(0);
  });
});

describe("aniListToMediaRow — null format fallback (NOT_YET_RELEASED)", () => {
  const base: AniListMedia = {
    id: 171630,
    type: "ANIME",
    format: null,
    episodes: 7,
    chapters: null,
    volumes: null,
    season: null,
    seasonYear: null,
    countryOfOrigin: "JP",
    title: { romaji: "THE ONE PIECE", english: "THE ONE PIECE", native: "THE ONE PIECE" },
    coverImage: { extraLarge: null },
  };

  it("classifies a null-format ANIME via `type` → animation", () => {
    expect(aniListToMediaRow(base, "planned").type).toBe("animation");
  });

  it("classifies a null-format MANGA via `type` → manga", () => {
    expect(aniListToMediaRow({ ...base, type: "MANGA" }, "planned").type).toBe("manga");
  });

  it("throws only when BOTH format and type are missing", () => {
    expect(() => aniListToMediaRow({ ...base, type: null }, "planned")).toThrow();
  });
});
