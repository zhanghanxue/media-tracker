import { describe, expect, it } from "vitest";

import { isSeriesGapCandidate, selectSeriesGaps } from "./series-gaps";
import type { IgdbGame } from "../sources/igdb";

const RELEASED = 1_000_000_000; // any past unix-seconds date

function game(over: Partial<IgdbGame>): IgdbGame {
  return { id: 1, name: "A Game", first_release_date: RELEASED, ...over } as IgdbGame;
}

describe("isSeriesGapCandidate", () => {
  it("keeps a main game, an expansion and a standalone expansion", () => {
    for (const game_type of [0, 2, 4]) {
      expect(isSeriesGapCandidate(game({ game_type }))).toBe(true);
    }
  });

  it("drops re-packagings of something already listed", () => {
    // DLC, bundle, remake, remaster, port, fork, pack, update.
    for (const game_type of [1, 3, 8, 9, 10, 11, 13, 14]) {
      expect(isSeriesGapCandidate(game({ game_type }))).toBe(false);
    }
  });

  it("drops an alternate edition of another entry", () => {
    expect(
      isSeriesGapCandidate(game({ game_type: 0, version_parent: 55 })),
    ).toBe(false);
  });

  it("drops an entry with no release date at all", () => {
    // IGDB carries a long tail of announced-then-abandoned rows.
    expect(
      isSeriesGapCandidate(game({ game_type: 0, first_release_date: undefined })),
    ).toBe(false);
  });

  it("keeps an entry whose release kind is unknown", () => {
    // Better a stray remaster than a silently dropped sequel.
    expect(isSeriesGapCandidate(game({ game_type: undefined }))).toBe(true);
  });

  it("reads the pre-rename `category` spelling too", () => {
    expect(isSeriesGapCandidate(game({ category: 0 }))).toBe(true);
    expect(isSeriesGapCandidate(game({ category: 1 }))).toBe(false);
  });

  it("reads an expanded game_type object", () => {
    expect(isSeriesGapCandidate(game({ game_type: { id: 0 } }))).toBe(true);
    expect(isSeriesGapCandidate(game({ game_type: { id: 3 } }))).toBe(false);
  });
});

describe("selectSeriesGaps", () => {
  it("filters and sorts newest release first", () => {
    const out = selectSeriesGaps([
      game({ id: 1, game_type: 0, first_release_date: 100 }),
      game({ id: 2, game_type: 1, first_release_date: 300 }), // DLC — dropped
      game({ id: 3, game_type: 0, first_release_date: 200 }),
    ]);
    expect(out.map((g) => g.id)).toEqual([3, 1]);
  });

  it("returns nothing for an empty series", () => {
    expect(selectSeriesGaps([])).toEqual([]);
  });
});
