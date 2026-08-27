import { describe, expect, it } from "vitest";

import {
  dedupeGaps,
  excludeTracked,
  scanSource,
  trackedExternalIds,
  type CollectionGap,
} from "./collectionGaps";
import type { MediaRow } from "./types";

function row(over: Partial<MediaRow>): MediaRow {
  return {
    external_source: null,
    external_id: null,
    anilist_id: null,
    tmdb_id: null,
    igdb_id: null,
    bangumi_id: null,
    ...over,
  } as MediaRow;
}

const game = (igdbId: string) =>
  row({ external_source: "igdb", external_id: igdbId });
const anime = (anilistId: string) =>
  row({ external_source: "anilist", external_id: anilistId });

function gap(externalId: string): CollectionGap {
  return {
    externalId,
    kind: "movie",
    title: externalId,
    subtitle: null,
    coverUrl: null,
    addRef: { source: "tmdb", mediaType: "movie", id: 1 },
  };
}

describe("scanSource", () => {
  it("recognizes a TMDB movie franchise", () => {
    expect(scanSource("tmdb:collection:1241")).toEqual({
      kind: "movie_franchise",
      tmdbId: 1241,
    });
  });

  it("recognizes a TMDB show's season group", () => {
    expect(scanSource("tmdb:tv:1399")).toEqual({
      kind: "tv_seasons",
      tmdbId: 1399,
    });
  });

  it("has no scan for a hand-made collection of unlinked items", () => {
    expect(scanSource("c_01H8XYZ", [row({})])).toBeNull();
    expect(scanSource("Stuff I like")).toBeNull();
  });

  it("rejects a malformed or absent id", () => {
    expect(scanSource(null)).toBeNull();
    expect(scanSource("tmdb:collection:")).toBeNull();
    expect(scanSource("tmdb:collection:abc")).toBeNull();
    expect(scanSource("tmdb:collection:0")).toBeNull();
    expect(scanSource("tmdb:collection:12x")).toBeNull();
    expect(scanSource("xtmdb:tv:12")).toBeNull();
  });

  it("reads a game series off the MEMBERS, not the collection id", () => {
    // Most of the game library predates "igdb:collection:" stamping and sits in
    // hand-made or backfilled groups — keying on the id would skip nearly all.
    expect(scanSource("col:hand-made", [game("1020"), game("1021")])).toEqual({
      kind: "igdb_series",
      gameIds: [1020, 1021],
      seriesIds: [],
    });
  });

  it("unions a stamped IGDB series id with the members' games", () => {
    expect(scanSource("igdb:collection:42", [game("1020")])).toEqual({
      kind: "igdb_series",
      gameIds: [1020],
      seriesIds: [42],
    });
  });

  it("scans a stamped IGDB series even with no linked members", () => {
    expect(scanSource("igdb:collection:42", [row({})])).toEqual({
      kind: "igdb_series",
      gameIds: [],
      seriesIds: [42],
    });
  });

  it("reads an anime chain off the members' AniList ids", () => {
    // AniList has no collection object; the auto-grouper's ids carry no source.
    expect(
      scanSource("series:37ce9ba0-uuid", [anime("21"), anime("22")]),
    ).toEqual({ kind: "anilist_chain", anilistIds: [21, 22] });
  });

  it("follows a cross-reference id, not just the source of record", () => {
    expect(
      scanSource("col:x", [
        row({ external_source: "bangumi", external_id: "9", anilist_id: "21" }),
      ]),
    ).toEqual({ kind: "anilist_chain", anilistIds: [21] });
  });

  it("dedupes member ids and drops unusable ones", () => {
    expect(
      scanSource("col:x", [game("7"), game("7"), row({ igdb_id: "0" })]),
    ).toEqual({ kind: "igdb_series", gameIds: [7], seriesIds: [] });
  });

  it("prefers the TMDB collection id over whatever the members carry", () => {
    expect(scanSource("tmdb:collection:1241", [game("7")])).toEqual({
      kind: "movie_franchise",
      tmdbId: 1241,
    });
  });

  it("prefers games over anime in a mixed collection", () => {
    expect(scanSource("col:x", [game("7"), anime("21")])).toEqual({
      kind: "igdb_series",
      gameIds: [7],
      seriesIds: [],
    });
  });
});

describe("dedupeGaps", () => {
  it("keeps the first of each external id", () => {
    const a = { ...gap("movie:1"), title: "first" };
    const b = { ...gap("movie:1"), title: "second" };
    expect(dedupeGaps([a, b, gap("movie:2")])).toEqual([a, gap("movie:2")]);
  });
});

describe("trackedExternalIds", () => {
  it("collects the external ids of TMDB-sourced rows", () => {
    expect(
      trackedExternalIds([
        row({ external_source: "tmdb", external_id: "movie:550" }),
        row({ external_source: "tmdb", external_id: "tv:1399:s1" }),
      ]),
    ).toEqual(new Set(["movie:550", "tv:1399:s1"]));
  });

  it("ignores rows whose source of record isn't TMDB", () => {
    // An AniList row cross-referenced to TMDB has no TMDB external_id; the
    // server probe is what catches those.
    expect(
      trackedExternalIds([
        row({ external_source: "anilist", external_id: "12345" }),
        row({ external_source: null, external_id: null }),
      ]),
    ).toEqual(new Set());
  });

  it("reads the requested source, not always TMDB", () => {
    const rows = [game("1020"), anime("21")];
    expect(trackedExternalIds(rows, "igdb")).toEqual(new Set(["1020"]));
    expect(trackedExternalIds(rows, "anilist")).toEqual(new Set(["21"]));
    expect(trackedExternalIds(rows, "tmdb")).toEqual(new Set());
  });
});

describe("excludeTracked", () => {
  it("drops candidates already in the library", () => {
    const kept = excludeTracked(
      [gap("movie:1"), gap("movie:2"), gap("movie:3")],
      new Set(["movie:2"]),
    );
    expect(kept.map((g) => g.externalId)).toEqual(["movie:1", "movie:3"]);
  });

  it("keeps everything when nothing is tracked", () => {
    expect(excludeTracked([gap("movie:1")], new Set())).toHaveLength(1);
  });

  it("returns nothing when the whole collection is tracked", () => {
    expect(
      excludeTracked([gap("movie:1")], new Set(["movie:1"])),
    ).toEqual([]);
  });
});
