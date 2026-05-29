import { describe, expect, it, vi } from "vitest";

import {
  bucketFor,
  matchEntry,
  scoreMatch,
  sourcesFor,
  type Candidate,
  type RawCandidate,
  type SearchFn,
} from "./match";
import type { ParsedEntry } from "./parse";

function entry(over: Partial<ParsedEntry> = {}): ParsedEntry {
  return {
    type: "animation",
    status: "planned",
    region: "japan",
    platform: null,
    consumptionMode: null,
    title: "进击的巨人",
    altTitles: [],
    parts: [],
    progress: null,
    videoUrl: null,
    line: 1,
    ...over,
  };
}

function cand(over: Partial<Candidate> = {}): Candidate {
  return { source: "bangumi", id: "1", titles: [], score: 0, payload: null, ...over };
}

describe("sourcesFor", () => {
  it("is CJK-first for anime/manga, TMDB-first for drama/movie", () => {
    expect(sourcesFor("animation")[0]).toEqual({ source: "bangumi", subtype: 2 });
    expect(sourcesFor("manga")[0]).toEqual({ source: "bangumi", subtype: 1 });
    expect(sourcesFor("drama")[0]).toEqual({ source: "tmdb", subtype: "tv" });
    expect(sourcesFor("movie")[0]).toEqual({ source: "tmdb", subtype: "movie" });
  });
  it("uses Bangumi type 6 for variety and IGDB→Bangumi(4) for games", () => {
    expect(sourcesFor("variety")[0]).toEqual({ source: "bangumi", subtype: 6 });
    expect(sourcesFor("game")).toEqual([
      { source: "igdb", subtype: null },
      { source: "bangumi", subtype: 4 },
    ]);
  });
});

describe("scoreMatch", () => {
  it("scores an exact normalized match as 1", () => {
    expect(scoreMatch(["进击的巨人"], ["进击的巨人"])).toBe(1);
  });
  it("ignores punctuation/width via normalizeTitle", () => {
    expect(scoreMatch(["NARUTO -ナルト-"], ["NARUTO"])).toBeGreaterThanOrEqual(0.7);
  });
  it("scores a prefix relationship ~0.7", () => {
    expect(scoreMatch(["唐朝诡事录"], ["唐朝诡事录之西行"])).toBeCloseTo(0.7);
  });
  it("scores no overlap as 0", () => {
    expect(scoreMatch(["进击的巨人"], ["海贼王"])).toBe(0);
  });
  it("applies the simplify fold (Traditional candidate ↔ Simplified entry)", () => {
    const simplify = (s: string) => s.replace("餘", "余").replace("慶", "庆");
    expect(scoreMatch(["庆余年"], ["慶餘年"], simplify)).toBe(1);
  });
});

describe("bucketFor", () => {
  it("none when there are no candidates or top score is 0", () => {
    expect(bucketFor(entry(), [])).toBe("none");
    expect(bucketFor(entry(), [cand({ score: 0 })])).toBe("none");
  });
  it("auto for a single unambiguous exact match", () => {
    expect(bucketFor(entry(), [cand({ score: 1 }), cand({ id: "2", score: 0.7 })])).toBe("auto");
  });
  it("review when two candidates tie at the top (ambiguous)", () => {
    expect(
      bucketFor(entry(), [cand({ score: 1 }), cand({ id: "2", score: 1 })]),
    ).toBe("review");
  });
  it("review for a series (bracketed) entry even on an exact hit", () => {
    expect(bucketFor(entry({ parts: ["1", "2"] }), [cand({ score: 1 })])).toBe("review");
  });
  it("review for a partial match", () => {
    expect(bucketFor(entry(), [cand({ score: 0.7 })])).toBe("review");
  });
});

describe("matchEntry", () => {
  const hit = (id: string, titles: string[]): RawCandidate => ({
    source: "bangumi",
    id,
    titles,
    payload: null,
  });

  it("queries the primary source, scores + buckets an exact hit as auto", async () => {
    const search: SearchFn = vi.fn(async (source) =>
      source === "bangumi" ? [hit("7", ["進撃の巨人", "进击的巨人"])] : [],
    );
    const res = await matchEntry(entry(), search);
    expect(res.bucket).toBe("auto");
    expect(res.candidates[0]).toMatchObject({ source: "bangumi", id: "7", score: 1 });
  });

  it("stops at the first source once it has an exact hit (no fallback call)", async () => {
    const search = vi.fn(async (source: string) =>
      source === "bangumi" ? [hit("7", ["进击的巨人"])] : [],
    ) as unknown as SearchFn;
    await matchEntry(entry(), search);
    const sourcesQueried = (search as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => c[0],
    );
    expect(sourcesQueried).toEqual(["bangumi"]); // anilist fallback skipped
  });

  it("falls through to the next source when the first finds nothing", async () => {
    const search = vi.fn(async (source: string) =>
      source === "anilist" ? [hit("a", ["进击的巨人"])] : [],
    ) as unknown as SearchFn;
    const res = await matchEntry(entry(), search);
    const sourcesQueried = (search as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => c[0],
    );
    expect(sourcesQueried).toEqual(["bangumi", "anilist"]);
    expect(res.candidates[0]!.id).toBe("a");
  });

  it("dedups a candidate seen twice (alt-title queries) keeping the best score", async () => {
    const search: SearchFn = vi.fn(async () => [hit("7", ["进击的巨人"])]);
    const res = await matchEntry(entry({ altTitles: ["AOT"] }), search);
    const fromBgm = res.candidates.filter((c) => c.id === "7");
    expect(fromBgm).toHaveLength(1);
  });

  it("buckets a no-match entry as none", async () => {
    const search: SearchFn = vi.fn(async () => []);
    const res = await matchEntry(entry(), search);
    expect(res.bucket).toBe("none");
    expect(res.candidates).toEqual([]);
  });

  it("sends a series entry to review with its candidates ranked", async () => {
    const search: SearchFn = vi.fn(async () => [
      hit("s1", ["进击的巨人"]),
      hit("s2", ["进击的巨人 第二季"]),
    ]);
    const res = await matchEntry(entry({ parts: ["1", "2", "3"] }), search);
    expect(res.bucket).toBe("review");
    expect(res.candidates[0]!.score).toBe(1); // exact ranked first
  });
});
