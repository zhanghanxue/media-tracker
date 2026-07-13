import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  chineseLookupPlan,
  removeFromRecommendationPools,
  type Recommendation,
} from "./recommend";
import type { AniListMedia } from "../../worker/sources/anilist";

function aniMedia(over: Partial<AniListMedia> = {}): AniListMedia {
  return {
    id: 104578,
    type: "ANIME",
    title: { romaji: "Vinland Saga", english: "Vinland Saga", native: "ヴィンランド・サガ" },
    coverImage: { extraLarge: null },
    format: "TV",
    episodes: 24,
    chapters: null,
    volumes: null,
    season: null,
    seasonYear: 2019,
    countryOfOrigin: "JP",
    ...over,
  };
}

function anilistRec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    source: "anilist",
    id: "104578",
    title: "Vinland Saga",
    titleChinese: null,
    titleNative: "ヴィンランド・サガ",
    coverUrl: null,
    becauseTitle: "Seed",
    addRef: { source: "anilist", media: aniMedia() },
    ...over,
  };
}

function igdbRec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    source: "igdb",
    id: "119171",
    title: "Wandering Sword",
    titleChinese: null,
    titleNative: null,
    coverUrl: null,
    becauseTitle: "Seed",
    addRef: { source: "igdb", id: 119171 },
    ...over,
  };
}

function tmdbRec(): Recommendation {
  return {
    source: "tmdb",
    id: "movie:603",
    title: "黑客帝国",
    titleChinese: null,
    titleNative: null,
    coverUrl: null,
    becauseTitle: "Seed",
    addRef: { source: "tmdb", id: 603, kind: "movie" },
  };
}

describe("chineseLookupPlan", () => {
  it("plans an anime lookup by all three AniList title variants (type 2)", () => {
    const plan = chineseLookupPlan(anilistRec());
    expect(plan).toEqual({
      titles: {
        native: "ヴィンランド・サガ",
        romaji: "Vinland Saga",
        english: "Vinland Saga",
      },
      bgmType: 2,
    });
  });

  it("plans a MANGA card against Bangumi's book type (1)", () => {
    const rec = anilistRec({
      addRef: { source: "anilist", media: aniMedia({ type: "MANGA" }) },
    });
    expect(chineseLookupPlan(rec)!.bgmType).toBe(1);
  });

  it("plans a game lookup by English name against Bangumi's game type (4) — IGDB alt-names cover almost nothing", () => {
    expect(chineseLookupPlan(igdbRec())).toEqual({
      titles: { native: null, romaji: null, english: "Wandering Sword" },
      bgmType: 4,
    });
  });

  it("skips cards that already have a Chinese title", () => {
    expect(chineseLookupPlan(igdbRec({ titleChinese: "逸剑风云决" }))).toBeNull();
  });

  it("skips TMDB cards (titles arrive zh-CN already)", () => {
    expect(chineseLookupPlan(tmdbRec())).toBeNull();
  });
});

describe("removeFromRecommendationPools", () => {
  it("drops the added item from its cached pool so the next candidate backfills (regression: invalidation refetched the slow anime pipeline and the stale pool kept showing the added card)", () => {
    const qc = new QueryClient();
    const added = anilistRec();
    const kept = anilistRec({ id: "999", title: "Other" });
    qc.setQueryData(["recommendations", "animation"], [added, kept]);
    qc.setQueryData(["recommendations", "game"], [igdbRec()]);

    removeFromRecommendationPools(qc, added);

    expect(qc.getQueryData(["recommendations", "animation"])).toEqual([kept]);
    // Other pools untouched (same id in another source must survive).
    expect(qc.getQueryData(["recommendations", "game"])).toHaveLength(1);
  });

  it("matches on source + id, not id alone", () => {
    const qc = new QueryClient();
    const game = igdbRec({ id: "104578" }); // same id as the anilist rec
    qc.setQueryData(["recommendations", "game"], [game]);

    removeFromRecommendationPools(qc, anilistRec()); // anilist:104578

    expect(qc.getQueryData(["recommendations", "game"])).toEqual([game]);
  });
});
