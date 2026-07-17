import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  chineseLookupPlan,
  pickAnimeSeeds,
  removeFromRecommendationPools,
  type Recommendation,
} from "./recommend";
import type { AniListMedia } from "../../worker/sources/anilist";
import type { MediaRow } from "./types";

// Tiny seeded PRNG (mulberry32) — deterministic "randomness" for seed sampling.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

describe("pickAnimeSeeds", () => {
  // Cast — only the fields pickAnimeSeeds reads matter here.
  function libRow(): MediaRow {
    return {
      id: 1,
      type: "animation",
      status: "completed",
      external_source: "anilist",
      external_id: "100",
      anilist_id: null,
      date_updated: "2026-01-01 00:00:00",
    } as MediaRow;
  }

  it("only seeds from completed/in_progress anime with an AniList id", () => {
    const items: MediaRow[] = [
      { ...libRow(), id: 1 },
      { ...libRow(), id: 2, status: "planned" }, // wrong status
      { ...libRow(), id: 3, type: "manga" }, // wrong type
      { ...libRow(), id: 4, external_source: "bangumi", external_id: "b1", anilist_id: null }, // no AniList id
      { ...libRow(), id: 5, external_source: "bangumi", external_id: "b2", anilist_id: "42" }, // cross-ref ok
    ];
    const out = pickAnimeSeeds(items, mulberry32(1));
    expect(new Set(out.map((r) => r.id))).toEqual(new Set([1, 5]));
  });

  it("caps at 20 seeds", () => {
    const items = Array.from({ length: 150 }, (_, i) => ({
      ...libRow(),
      id: i + 1,
    }));
    expect(pickAnimeSeeds(items, mulberry32(1))).toHaveLength(20);
  });

  it("is deterministic for a given rng, and varies across rngs", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      ...libRow(),
      id: i + 1,
    }));
    const ids = (seed: number) =>
      pickAnimeSeeds(items, mulberry32(seed)).map((r) => r.id);
    expect(ids(7)).toEqual(ids(7));
    const draws = [1, 2, 3, 4, 5].map((s) => ids(s).join(","));
    expect(new Set(draws).size).toBeGreaterThan(1);
  });
});

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
