import { describe, it, expect } from "vitest";
import {
  diffTmdbSeasons,
  findNewSequels,
  type RelationEdge,
  type SeasonInfo,
} from "./whats-new";

function season(n: number, air_date: string | null = "2020-01-01"): SeasonInfo {
  return { season_number: n, name: `S${n}`, episode_count: 12, air_date, poster_path: null };
}

describe("diffTmdbSeasons", () => {
  it("returns aired seasons not already owned, sorted", () => {
    const available = [season(1), season(3), season(2)];
    const out = diffTmdbSeasons([1], available);
    expect(out.map((s) => s.season_number)).toEqual([2, 3]);
  });

  it("excludes the season-0 specials bucket", () => {
    expect(diffTmdbSeasons([1], [season(0), season(1)])).toEqual([]);
  });

  it("excludes unaired/placeholder seasons (no air_date)", () => {
    const out = diffTmdbSeasons([1], [season(2, null)]);
    expect(out).toEqual([]);
  });

  it("returns nothing when fully caught up", () => {
    expect(diffTmdbSeasons([1, 2], [season(1), season(2)])).toEqual([]);
  });
});

describe("findNewSequels", () => {
  const edge = (
    relationType: string,
    id: number,
    format: string | null = "TV",
  ): RelationEdge => ({ relationType, node: { id, type: "ANIME", format } });

  it("returns SEQUEL targets not in the library", () => {
    const out = findNewSequels([edge("SEQUEL", 200)], new Set(["100"]));
    expect(out.map((c) => c.id)).toEqual([200]);
  });

  it("ignores non-SEQUEL relations (PREQUEL, SIDE_STORY, …)", () => {
    const out = findNewSequels(
      [edge("PREQUEL", 50), edge("SIDE_STORY", 60)],
      new Set(),
    );
    expect(out).toEqual([]);
  });

  it("ignores sequels already in the library", () => {
    const out = findNewSequels([edge("SEQUEL", 200)], new Set(["200"]));
    expect(out).toEqual([]);
  });

  it("skips non-season-like sequel formats (recap MOVIE / OVA / MUSIC)", () => {
    const out = findNewSequels(
      [edge("SEQUEL", 1, "MOVIE"), edge("SEQUEL", 2, "OVA"), edge("SEQUEL", 3, "TV")],
      new Set(),
    );
    expect(out.map((c) => c.id)).toEqual([3]);
  });

  it("dedupes repeated sequel ids", () => {
    const out = findNewSequels([edge("SEQUEL", 9), edge("SEQUEL", 9)], new Set());
    expect(out.map((c) => c.id)).toEqual([9]);
  });

  it("allows a null format through (announced sequel, format not yet set)", () => {
    const out = findNewSequels([edge("SEQUEL", 7, null)], new Set());
    expect(out.map((c) => c.id)).toEqual([7]);
  });
});
