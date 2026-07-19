import { describe, expect, it } from "vitest";

import {
  igdbIdOf,
  partitionGroups,
  selectCandidates,
  tmdbMovieIdOf,
  type Group,
  type PlanRow,
} from "./franchise-plan";

function row(over: Partial<PlanRow> = {}): PlanRow {
  return {
    id: 1,
    type: "movie",
    collection_id: null,
    external_source: "tmdb",
    external_id: "movie:1366",
    igdb_id: null,
    tmdb_id: null,
    ...over,
  };
}

describe("tmdbMovieIdOf", () => {
  it("reads the kind-prefixed id of a TMDB-sourced movie", () => {
    expect(tmdbMovieIdOf(row())).toBe(1366);
  });

  it("falls back to the tmdb_id cross-reference for other sources", () => {
    expect(
      tmdbMovieIdOf(
        row({ external_source: "bangumi", external_id: "123", tmdb_id: "movie:99" }),
      ),
    ).toBe(99);
  });

  it("rejects a tv id — a show/season is not a film franchise", () => {
    expect(tmdbMovieIdOf(row({ external_id: "tv:1399" }))).toBeNull();
    expect(
      tmdbMovieIdOf(
        row({ external_source: "bangumi", external_id: "1", tmdb_id: "tv:1399" }),
      ),
    ).toBeNull();
  });

  it("accepts a bare numeric id (older rows)", () => {
    expect(tmdbMovieIdOf(row({ external_id: "1366" }))).toBe(1366);
  });

  it("returns null with no usable link", () => {
    expect(tmdbMovieIdOf(row({ external_source: "anilist", external_id: "5" }))).toBeNull();
    expect(tmdbMovieIdOf(row({ external_id: null }))).toBeNull();
    expect(tmdbMovieIdOf(row({ external_id: "movie:0" }))).toBeNull();
    expect(tmdbMovieIdOf(row({ external_id: "movie:abc" }))).toBeNull();
  });
});

describe("igdbIdOf", () => {
  it("reads the bare id of an IGDB-sourced game", () => {
    expect(igdbIdOf(row({ type: "game", external_source: "igdb", external_id: "1942" }))).toBe(1942);
  });

  it("falls back to the igdb_id cross-reference", () => {
    expect(
      igdbIdOf(row({ type: "game", external_source: "bangumi", igdb_id: "1942" })),
    ).toBe(1942);
  });

  it("returns null with no usable link", () => {
    expect(igdbIdOf(row({ type: "game", external_source: "bangumi" }))).toBeNull();
  });
});

describe("selectCandidates", () => {
  const both = { movies: true, games: true };

  it("never touches a row that is already in a collection", () => {
    const grouped = row({ collection_id: "col:manual" });
    expect(selectCandidates([grouped], both)).toEqual([]);
  });

  it("picks up loose movies and games with a source link", () => {
    const movie = row({ id: 1 });
    const game = row({ id: 2, type: "game", external_source: "igdb", external_id: "1942" });
    expect(selectCandidates([movie, game], both).map((r) => r.id)).toEqual([1, 2]);
  });

  it("skips types that have no franchise concept here", () => {
    const anime = row({ id: 3, type: "animation", external_source: "anilist", external_id: "1" });
    const manga = row({ id: 4, type: "manga", external_source: "anilist", external_id: "2" });
    expect(selectCandidates([anime, manga], both)).toEqual([]);
  });

  it("honours --movies-only / --games-only", () => {
    const movie = row({ id: 1 });
    const game = row({ id: 2, type: "game", external_source: "igdb", external_id: "1942" });
    expect(
      selectCandidates([movie, game], { movies: true, games: false }).map((r) => r.id),
    ).toEqual([1]);
    expect(
      selectCandidates([movie, game], { movies: false, games: true }).map((r) => r.id),
    ).toEqual([2]);
  });
});

describe("partitionGroups", () => {
  const g = (n: number): Group<number> => ({
    rows: Array.from({ length: n }, (_, i) => i),
    name: null,
  });

  it("files a franchise with two or more loose members", () => {
    const { actionable, singletons } = partitionGroups(
      new Map([["tmdb:collection:1575", g(3)]]),
      new Set(),
    );
    expect(actionable.map(([k]) => k)).toEqual(["tmdb:collection:1575"]);
    expect(singletons).toEqual([]);
  });

  it("skips a lone member — a one-film collection is noise", () => {
    const { actionable, singletons } = partitionGroups(
      new Map([["tmdb:collection:1575", g(1)]]),
      new Set(),
    );
    expect(actionable).toEqual([]);
    expect(singletons.map(([k]) => k)).toEqual(["tmdb:collection:1575"]);
  });

  it("lets a lone straggler join a group that already exists", () => {
    const { actionable, singletons } = partitionGroups(
      new Map([["tmdb:collection:1575", g(1)]]),
      new Set(["tmdb:collection:1575"]),
    );
    expect(actionable.map(([k]) => k)).toEqual(["tmdb:collection:1575"]);
    expect(singletons).toEqual([]);
  });

  it("partitions a mixed batch", () => {
    const { actionable, singletons } = partitionGroups(
      new Map([
        ["tmdb:collection:1", g(2)],
        ["tmdb:collection:2", g(1)],
        ["igdb:collection:3", g(1)],
      ]),
      new Set(["igdb:collection:3"]),
    );
    expect(actionable.map(([k]) => k)).toEqual(["tmdb:collection:1", "igdb:collection:3"]);
    expect(singletons.map(([k]) => k)).toEqual(["tmdb:collection:2"]);
  });
});
