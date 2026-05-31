import { describe, it, expect } from "vitest";
import {
  aggregateRecommendations,
  sourceIdOf,
  type RecCandidate,
  type SeedRefRow,
} from "./recommend";

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
