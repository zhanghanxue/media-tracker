import { describe, it, expect } from "vitest";
import {
  aggregateRecommendations,
  sampleSeeds,
  shuffleRankedPool,
  sourceIdOf,
  type RankedRecommendation,
  type RecCandidate,
  type SeedRefRow,
} from "./recommend";

// Tiny seeded PRNG (mulberry32) — tests need deterministic "randomness".
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Trivial normalizer for tests (lowercase, strip spaces) — the real one is the
// source mappers' normalizeTitle; aggregate only needs SOME canonicalizer.
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

function cand(over: Partial<RecCandidate>): RecCandidate {
  return {
    source: "tmdb",
    id: "movie:1",
    title: "A",
    coverUrl: null,
    score: 0,
    seedTitle: "Seed",
    ...over,
  };
}

const base = { excludedIds: new Set<string>(), excludedTitles: new Set<string>(), normalize: norm, limit: 10 };

describe("aggregateRecommendations", () => {
  it("tallies how many seeds surfaced each candidate and ranks by count", () => {
    const out = aggregateRecommendations(
      [
        cand({ id: "movie:1", title: "Popular", seedTitle: "X" }),
        cand({ id: "movie:1", title: "Popular", seedTitle: "Y" }),
        cand({ id: "movie:2", title: "Niche", seedTitle: "X" }),
      ],
      base,
    );
    expect(out.map((r) => [r.id, r.count])).toEqual([
      ["movie:1", 2],
      ["movie:2", 1],
    ]);
  });

  it("excludes candidates already in the library by id", () => {
    const out = aggregateRecommendations(
      [cand({ id: "movie:1" }), cand({ id: "movie:2" })],
      { ...base, excludedIds: new Set(["tmdb:movie:1"]) },
    );
    expect(out.map((r) => r.id)).toEqual(["movie:2"]);
  });

  it("excludes candidates already in the library by normalized title", () => {
    const out = aggregateRecommendations(
      [cand({ id: "movie:9", title: "Spirited Away" })],
      { ...base, excludedTitles: new Set([norm("spirited away")]) },
    );
    expect(out).toEqual([]);
  });

  it("attributes the why to the highest-scoring seed", () => {
    const out = aggregateRecommendations(
      [
        cand({ id: "movie:1", seedTitle: "Weak", score: 1 }),
        cand({ id: "movie:1", seedTitle: "Strong", score: 9 }),
      ],
      base,
    );
    expect(out[0]!.becauseTitle).toBe("Strong");
  });

  it("breaks count ties by total score, then title", () => {
    const out = aggregateRecommendations(
      [
        cand({ id: "movie:1", title: "Bbb", score: 5 }),
        cand({ id: "movie:2", title: "Aaa", score: 9 }),
      ],
      base,
    );
    expect(out.map((r) => r.id)).toEqual(["movie:2", "movie:1"]); // higher score first
  });

  it("caps the result at the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => cand({ id: `movie:${i}`, title: `T${i}` }));
    expect(aggregateRecommendations(many, { ...base, limit: 5 })).toHaveLength(5);
  });

  it("passes titleChinese through (null when the candidate has none)", () => {
    const out = aggregateRecommendations(
      [
        cand({ source: "igdb", id: "1", title: "Wandering Sword", titleChinese: "逸剑风云决" }),
        cand({ source: "igdb", id: "2", title: "No Alias" }),
      ],
      base,
    );
    const byId = new Map(out.map((r) => [r.id, r.titleChinese]));
    expect(byId.get("1")).toBe("逸剑风云决");
    expect(byId.get("2")).toBeNull();
  });
});

describe("sampleSeeds", () => {
  const pool = ["a", "b", "c", "d", "e", "f", "g", "h"];

  it("returns `limit` distinct items from the pool", () => {
    const out = sampleSeeds(pool, 3, mulberry32(1));
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
    for (const x of out) expect(pool).toContain(x);
  });

  it("returns the whole pool (shuffled) when pool <= limit", () => {
    const out = sampleSeeds(pool, 20, mulberry32(1));
    expect([...out].sort()).toEqual([...pool].sort());
  });

  it("does not mutate the input", () => {
    const input = ["a", "b", "c"];
    sampleSeeds(input, 2, mulberry32(1));
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("is deterministic for a given rng, and varies across rngs", () => {
    expect(sampleSeeds(pool, 4, mulberry32(7))).toEqual(
      sampleSeeds(pool, 4, mulberry32(7)),
    );
    // Different seeds — at least one of several draws must differ.
    const draws = [1, 2, 3, 4, 5].map((s) =>
      sampleSeeds(pool, 4, mulberry32(s)).join(""),
    );
    expect(new Set(draws).size).toBeGreaterThan(1);
  });
});

describe("shuffleRankedPool", () => {
  const rec = (id: string, count: number): RankedRecommendation => ({
    source: "tmdb",
    id,
    title: id,
    titleChinese: null,
    coverUrl: null,
    count,
    becauseTitle: "Seed",
  });

  it("preserves tier order (all count=3 before count=2 before count=1)", () => {
    const pool = [
      rec("a", 3), rec("b", 3),
      rec("c", 2), rec("d", 2), rec("e", 2),
      rec("f", 1),
    ];
    for (const seed of [1, 2, 3, 4, 5]) {
      const out = shuffleRankedPool(pool, mulberry32(seed));
      expect(out.map((r) => r.count)).toEqual([3, 3, 2, 2, 2, 1]);
      expect(new Set(out.map((r) => r.id))).toEqual(
        new Set(pool.map((r) => r.id)),
      );
    }
  });

  it("permutes within a tier (some rng produces a non-identity order)", () => {
    const pool = [rec("a", 2), rec("b", 2), rec("c", 2), rec("d", 2)];
    const orders = [1, 2, 3, 4, 5].map((s) =>
      shuffleRankedPool(pool, mulberry32(s)).map((r) => r.id).join(""),
    );
    expect(new Set(orders).size).toBeGreaterThan(1);
  });

  it("is a no-op for empty and singleton pools", () => {
    expect(shuffleRankedPool([], mulberry32(1))).toEqual([]);
    const one = [rec("a", 1)];
    expect(shuffleRankedPool(one, mulberry32(1))).toEqual(one);
  });
});

describe("sourceIdOf", () => {
  const row = (over: Partial<SeedRefRow>): SeedRefRow => ({
    external_source: null,
    external_id: null,
    anilist_id: null,
    tmdb_id: null,
    igdb_id: null,
    bangumi_id: null,
    ...over,
  });

  it("uses external_id when the source is the row's primary source", () => {
    expect(sourceIdOf(row({ external_source: "tmdb", external_id: "movie:5" }), "tmdb")).toBe("movie:5");
  });

  it("uses the cross-reference column when the source is secondary", () => {
    expect(
      sourceIdOf(row({ external_source: "bangumi", external_id: "b1", anilist_id: "42" }), "anilist"),
    ).toBe("42");
  });

  it("returns null when the row has no id for that source", () => {
    expect(sourceIdOf(row({ external_source: "bangumi", external_id: "b1" }), "igdb")).toBeNull();
  });
});
