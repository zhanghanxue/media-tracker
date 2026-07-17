import { describe, expect, it } from "vitest";

import {
  cleanupGenre,
  genreLikePattern,
  joinGenres,
  normalizeGenres,
  splitGenres,
} from "./genres";

describe("cleanupGenre", () => {
  it("collapses IGDB's parenthetical RPG label, then canonicalizes to Chinese", () => {
    expect(cleanupGenre("Role-playing (RPG)")).toBe("角色扮演");
  });
  it("chains cleanup then canonical: Science Fiction → Sci-Fi → 科幻 (both TMDB and IGDB casings)", () => {
    expect(cleanupGenre("Science Fiction")).toBe("科幻");
    expect(cleanupGenre("Science fiction")).toBe("科幻");
  });
  it("translates plain English names to the canonical Chinese form", () => {
    expect(cleanupGenre("Action")).toBe("动作");
    expect(cleanupGenre("  Slice of Life ")).toBe("日常");
  });
  it("keeps Chinese (Bangumi) names as-is — they ARE the canonical form", () => {
    expect(cleanupGenre("武侠")).toBe("武侠");
    expect(cleanupGenre("动作")).toBe("动作");
  });
  it("passes through English names with no Chinese counterpart", () => {
    expect(cleanupGenre("MOBA")).toBe("MOBA");
    expect(cleanupGenre("4X")).toBe("4X");
  });
});

describe("normalizeGenres", () => {
  it("cleans, de-dupes, preserves order, drops blanks", () => {
    expect(
      normalizeGenres(["Action", "", "Action", "Role-playing (RPG)", "  "]),
    ).toEqual(["动作", "角色扮演"]);
  });
  it("de-dupes AFTER canonicalization (English + Chinese variants collapse)", () => {
    expect(normalizeGenres(["Action", "动作", "War", "Warfare"])).toEqual([
      "动作",
      "战争",
    ]);
  });
  it("drops names containing the sentinel (would corrupt encoding)", () => {
    expect(normalizeGenres(["Good", "Ba|d"])).toEqual(["Good"]);
  });
});

describe("joinGenres / splitGenres round-trip", () => {
  it("wraps with sentinels (canonicalized) and round-trips", () => {
    const stored = joinGenres(["RPG", "Action"]);
    expect(stored).toBe("|角色扮演|动作|");
    expect(splitGenres(stored)).toEqual(["角色扮演", "动作"]);
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
