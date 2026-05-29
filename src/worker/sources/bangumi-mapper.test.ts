import { describe, expect, it } from "vitest";

import {
  bangumiToMediaRow,
  pickAniListMatch,
  pickBangumiChineseTitle,
  pickLatinAlias,
} from "./bangumi-mapper";
import type { BangumiSubject } from "./bangumi";
import type { AniListMedia } from "./anilist";

import detailAnimeFixture from "../../../test/fixtures/bangumi/detail_anime_245665.json";

const ANIME = detailAnimeFixture as unknown as BangumiSubject;

function book(overrides: Partial<BangumiSubject> = {}): BangumiSubject {
  return {
    id: 9999,
    type: 1,
    name: "ベルセルク",
    name_cn: "剑风传奇",
    platform: "漫画",
    eps: 0,
    volumes: 41,
    images: { large: "https://lain.bgm.tv/x.jpg", common: null, medium: null, small: null, grid: null },
    ...overrides,
  };
}

describe("bangumiToMediaRow — anime (type 2)", () => {
  it("maps the captured Demon Slayer subject to an animation row", () => {
    const row = bangumiToMediaRow(ANIME, "planned");

    expect(row.type).toBe("animation");
    expect(row.region).toBeNull(); // unknown by default; set via the editor
    expect(row.title_native).toBe("鬼滅の刃");
    expect(row.title_chinese).toBe("鬼灭之刃");
    // The 别名 Latin alias is a localized English title → title_english (NOT
    // romaji, which is the Japanese reading and which Bangumi doesn't provide).
    expect(row.title_english).toBe("Demon Slayer: Kimetsu no Yaiba");
    expect(row.title_romaji).toBeNull();
    expect(row.status).toBe("planned");
    expect(row.external_source).toBe("bangumi");
    expect(row.external_id).toBe("245665");
    expect(row.total_episodes).toBe(26);
    expect(row.total_chapters).toBeNull();
    expect(row.cover_url).toBe(ANIME.images!.large);
  });

  it("accepts a region override (non-Chinese exception)", () => {
    const row = bangumiToMediaRow(ANIME, "planned", "japan");
    expect(row.region).toBe("japan");
  });
});

describe("bangumiToMediaRow — book (type 1)", () => {
  it("defaults a comic platform to manga and fills total_chapters from volumes", () => {
    const row = bangumiToMediaRow(book(), "in_progress");
    expect(row.type).toBe("manga");
    expect(row.total_episodes).toBeNull();
    expect(row.total_chapters).toBe(41); // eps=0 → falls back to volumes
  });

  it("prefers eps over volumes for total_chapters when eps is positive", () => {
    const row = bangumiToMediaRow(book({ eps: 364, volumes: 41 }), "completed");
    expect(row.total_chapters).toBe(364);
  });

  it("maps a 小说 platform to light_novel", () => {
    const row = bangumiToMediaRow(book({ platform: "小说" }), "planned");
    expect(row.type).toBe("light_novel");
  });

  it("treats an empty name_cn as a null title_chinese", () => {
    const row = bangumiToMediaRow(book({ name_cn: "  " }), "planned");
    expect(row.title_chinese).toBeNull();
  });
});

describe("bangumiToMediaRow — live-action (type 6)", () => {
  // A Chinese drama season: native name is already Chinese, name_cn often empty,
  // platform 华语剧, eps 0 (Bangumi doesn't always fill it). Mirrors the live probe.
  function live(overrides: Partial<BangumiSubject> = {}): BangumiSubject {
    return {
      id: 613761,
      type: 6,
      name: "唐朝诡事录之蜀道",
      name_cn: "",
      platform: "华语剧",
      eps: 0,
      total_episodes: 0,
      images: { large: "https://lain.bgm.tv/d.jpg", common: null, medium: null, small: null, grid: null },
      ...overrides,
    };
  }

  it("maps a 华语剧 platform to a China drama with episode tracking", () => {
    const row = bangumiToMediaRow(live(), "in_progress");
    expect(row.type).toBe("drama");
    expect(row.region).toBe("china"); // inferred from the live-action platform
    expect(row.title_native).toBe("唐朝诡事录之蜀道");
    expect(row.total_chapters).toBeNull(); // dramas track episodes, not chapters
  });

  it("fills total_episodes from eps/total_episodes when present", () => {
    expect(bangumiToMediaRow(live({ total_episodes: 40 }), "planned").total_episodes).toBe(40);
    expect(bangumiToMediaRow(live({ eps: 36, total_episodes: 0 }), "planned").total_episodes).toBe(36);
    expect(bangumiToMediaRow(live(), "planned").total_episodes).toBeNull(); // eps 0 → unknown
  });

  it("maps a 电影 platform to a movie that tracks neither episodes nor chapters", () => {
    const row = bangumiToMediaRow(
      live({ platform: "电影", name: "流浪地球", name_cn: "" }),
      "completed",
    );
    expect(row.type).toBe("movie");
    expect(row.total_episodes).toBeNull();
    expect(row.total_chapters).toBeNull();
  });

  it("infers region from other live-action platforms", () => {
    expect(bangumiToMediaRow(live({ platform: "日剧" }), "planned").region).toBe("japan");
    expect(bangumiToMediaRow(live({ platform: "韩剧" }), "planned").region).toBe("korea");
    expect(bangumiToMediaRow(live({ platform: "欧美剧" }), "planned").region).toBe("usa");
    expect(bangumiToMediaRow(live({ platform: "" }), "planned").region).toBeNull();
  });

  it("prefers the infobox 国家/地区 over the generic 华语剧 platform (HK case)", () => {
    // 使徒行者 (verified live): platform 华语剧 but 国家/地区 = 香港 → hong_kong,
    // NOT china (the bug the user hit).
    const row = bangumiToMediaRow(
      live({
        platform: "华语剧",
        infobox: [{ key: "国家/地区", value: "香港" }],
      }),
      "planned",
    );
    expect(row.region).toBe("hong_kong");
  });

  it("reads 国家/地区 = 中国大陆 → china and 台湾 → taiwan", () => {
    expect(
      bangumiToMediaRow(
        live({ platform: "华语剧", infobox: [{ key: "国家/地区", value: "中国大陆" }] }),
        "planned",
      ).region,
    ).toBe("china");
    expect(
      bangumiToMediaRow(
        live({ platform: "华语剧", infobox: [{ key: "国家/地区", value: "台湾" }] }),
        "planned",
      ).region,
    ).toBe("taiwan");
  });

  it("lets an explicit region override the platform inference", () => {
    const row = bangumiToMediaRow(live(), "planned", "taiwan");
    expect(row.region).toBe("taiwan");
  });
});

describe("bangumiToMediaRow — unsupported", () => {
  it("throws on a game/music subject type", () => {
    expect(() => bangumiToMediaRow(book({ type: 4 }), "planned")).toThrow(
      /Unsupported Bangumi subject type/,
    );
  });
});

// --- pickAniListMatch ------------------------------------------------------

function media(overrides: Partial<AniListMedia["title"]>): AniListMedia {
  return {
    id: 1,
    title: { romaji: null, english: null, native: null, ...overrides },
    coverImage: { extraLarge: null },
    format: "TV",
    episodes: null,
    chapters: null,
    volumes: null,
    season: null,
    seasonYear: null,
    countryOfOrigin: null,
  };
}

describe("pickAniListMatch", () => {
  it("matches on a native title variant", () => {
    const results = [media({ native: "別のアニメ" }), media({ native: "鬼滅の刃" })];
    expect(pickAniListMatch(["鬼滅の刃", null], results)?.title.native).toBe(
      "鬼滅の刃",
    );
  });

  it("matches a romaji variant", () => {
    const results = [media({ romaji: "Kimetsu no Yaiba" })];
    expect(pickAniListMatch(["Kimetsu no Yaiba"], results)).toBe(results[0]);
  });

  it("matches english case-insensitively", () => {
    const results = [media({ english: "Demon Slayer" })];
    expect(pickAniListMatch(["demon slayer"], results)).toBe(results[0]);
  });

  it("matches across fullwidth↔ASCII numerals (the Record of Ragnarok III bug)", () => {
    // Bangumi native uses fullwidth Ⅲ (U+2162); AniList native uses " III".
    const results = [
      media({ native: "終末のワルキューレ III", english: "Record of Ragnarok III" }),
    ];
    expect(pickAniListMatch(["終末のワルキューレⅢ", null], results)).toBe(
      results[0],
    );
  });

  it("matches via the Latin alias variant when the native doesn't line up", () => {
    const results = [media({ english: "Record of Ragnarok II Part 2" })];
    expect(
      pickAniListMatch(["終末のワルキューレⅡ 後編", "Record of Ragnarok II Part 2"], results),
    ).toBe(results[0]);
  });

  it("returns null when nothing matches (→ fall back to Bangumi-direct)", () => {
    const results = [media({ native: "進撃の巨人", romaji: "Shingeki no Kyojin" })];
    expect(pickAniListMatch(["鬼滅の刃", "Demon Slayer"], results)).toBeNull();
  });

  it("returns null for empty results or empty variants", () => {
    expect(pickAniListMatch(["鬼滅の刃"], [])).toBeNull();
    expect(pickAniListMatch([" ", null], [media({ native: "鬼滅の刃" })])).toBeNull();
  });
});

describe("pickLatinAlias", () => {
  const ib = (aliases: string[]) => [
    { key: "中文名", value: "鬼灭之刃" },
    { key: "别名", value: aliases.map((v) => ({ v })) },
    { key: "话数", value: "26" },
  ];

  it("returns the first predominantly-Latin alias", () => {
    expect(
      pickLatinAlias(ib(["鬼灭之刃 灶门炭治郎", "Demon Slayer: Kimetsu no Yaiba"])),
    ).toBe("Demon Slayer: Kimetsu no Yaiba");
  });

  it("works for the season-part case that AniList search misses", () => {
    expect(pickLatinAlias(ib(["Record of Ragnarok Season 2 Part 1"]))).toBe(
      "Record of Ragnarok Season 2 Part 1",
    );
  });

  it("ignores CJK-only aliases and returns null when there's no Latin one", () => {
    expect(pickLatinAlias(ib(["終末のワルキューレⅢ", "终末的女武神 第三季"]))).toBeNull();
  });

  it("returns null for missing/empty infobox", () => {
    expect(pickLatinAlias(undefined)).toBeNull();
    expect(pickLatinAlias([])).toBeNull();
  });

  it("handles a string-valued 别名 (not just arrays)", () => {
    expect(pickLatinAlias([{ key: "别名", value: "World's End Harem" }])).toBe(
      "World's End Harem",
    );
  });
});

describe("pickBangumiChineseTitle", () => {
  function subject(overrides: Partial<BangumiSubject>): BangumiSubject {
    return {
      id: 1,
      type: 2,
      name: "",
      name_cn: "",
      images: null,
      ...overrides,
    };
  }

  it("returns the name_cn of the subject whose name exactly matches a variant", () => {
    const results = [
      subject({ name: "別のアニメ", name_cn: "别的动画" }),
      subject({ name: "鬼滅の刃", name_cn: "鬼滅之刃" }), // raw (still Traditional)
    ];
    expect(pickBangumiChineseTitle(["鬼滅の刃", null, null], results)).toBe(
      "鬼滅之刃",
    );
  });

  it("matches across subtitle/edition differences via prefix (the NARUTO case)", () => {
    // AniList romaji "NARUTO" vs Bangumi name "NARUTO -ナルト-" — exact-only
    // matching missed this; prefix matching catches it.
    const results = [subject({ name: "NARUTO -ナルト-", name_cn: "火影忍者" })];
    expect(
      pickBangumiChineseTitle(["NARUTO", "NARUTO", "Naruto"], results),
    ).toBe("火影忍者");
  });

  it("normalizes full-width punctuation/spacing before comparing", () => {
    const results = [subject({ name: "ＯＮＥ　ＰＩＥＣＥ", name_cn: "海贼王" })];
    expect(pickBangumiChineseTitle(["ONE PIECE", null, null], results)).toBe(
      "海贼王",
    );
  });

  it("prefers the relevance-first subject when several could prefix-match", () => {
    // v0 returns the main series first; we should take it, not a side entry.
    const results = [
      subject({ name: "NARUTO -ナルト-", name_cn: "火影忍者" }),
      subject({ name: "NARUTO -ナルト- 疾風伝", name_cn: "火影忍者疾风传" }),
    ];
    expect(pickBangumiChineseTitle(["NARUTO", null, null], results)).toBe(
      "火影忍者",
    );
  });

  it("does NOT assign the franchise title to a movie that merely starts with it", () => {
    // The Bleach-movies bug: searching a movie surfaces the base series first;
    // the base name ("BLEACH") must not match the longer movie title.
    const results = [subject({ name: "BLEACH", name_cn: "死神" })];
    expect(
      pickBangumiChineseTitle(
        [
          "劇場版BLEACH 地獄篇",
          "Bleach: Hell Verse",
          "Bleach: The Hell Verse",
        ],
        results,
      ),
    ).toBeNull();
  });

  it("still matches the franchise itself (base title) via subtitle prefix", () => {
    // The base-series row SHOULD match "BLEACH" → 死神.
    const results = [subject({ name: "BLEACH", name_cn: "死神" })];
    expect(pickBangumiChineseTitle(["BLEACH", "Bleach", null], results)).toBe(
      "死神",
    );
  });

  it("returns null when nothing relates to any variant (don't guess)", () => {
    const results = [subject({ name: "進撃の巨人", name_cn: "进击的巨人" })];
    expect(
      pickBangumiChineseTitle(["鬼滅の刃", "Kimetsu", "Demon Slayer"], results),
    ).toBeNull();
  });

  it("returns null when the matched subject has an empty name_cn", () => {
    const results = [subject({ name: "鬼滅の刃", name_cn: "  " })];
    expect(pickBangumiChineseTitle(["鬼滅の刃", null, null], results)).toBeNull();
  });

  it("returns null when all variants are empty", () => {
    expect(
      pickBangumiChineseTitle([null, "", "  "], [subject({ name: "鬼滅の刃" })]),
    ).toBeNull();
  });
});
