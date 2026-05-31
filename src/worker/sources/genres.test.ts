import { describe, expect, it } from "vitest";

import {
  cleanupGenre,
  genreLikePattern,
  joinGenres,
  normalizeGenres,
  splitGenres,
} from "./genres";

describe("cleanupGenre", () => {
  it("collapses IGDB's parenthetical RPG label", () => {
    expect(cleanupGenre("Role-playing (RPG)")).toBe("RPG");
  });
  it("normalizes Science Fiction → Sci-Fi", () => {
    expect(cleanupGenre("Science Fiction")).toBe("Sci-Fi");
  });
  it("trims and passes through unmapped names", () => {
    expect(cleanupGenre("  Slice of Life ")).toBe("Slice of Life");
  });
});

describe("normalizeGenres", () => {
  it("cleans, de-dupes, preserves order, drops blanks", () => {
    expect(
      normalizeGenres(["Action", "", "Action", "Role-playing (RPG)", "  "]),
    ).toEqual(["Action", "RPG"]);
  });
  it("drops names containing the sentinel (would corrupt encoding)", () => {
    expect(normalizeGenres(["Good", "Ba|d"])).toEqual(["Good"]);
  });
});

describe("joinGenres / splitGenres round-trip", () => {
  it("wraps with sentinels and round-trips", () => {
    const stored = joinGenres(["RPG", "Action"]);
    expect(stored).toBe("|RPG|Action|");
    expect(splitGenres(stored)).toEqual(["RPG", "Action"]);
  });
  it("returns null for an empty / all-blank list", () => {
    expect(joinGenres([])).toBeNull();
    expect(joinGenres(["", "  "])).toBeNull();
  });
  it("splitGenres on null/empty is []", () => {
    expect(splitGenres(null)).toEqual([]);
    expect(splitGenres("")).toEqual([]);
  });
});

describe("genreLikePattern", () => {
  it("wraps the token in sentinels so it matches a whole genre only", () => {
    expect(genreLikePattern("RPG")).toBe("%|RPG|%");
  });
  it("escapes LIKE wildcards in the genre name", () => {
    expect(genreLikePattern("50%_off")).toBe("%|50\\%\\_off|%");
  });
});
