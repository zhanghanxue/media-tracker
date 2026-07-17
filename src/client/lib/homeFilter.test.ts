import { describe, expect, it } from "vitest";

import { effectiveLevelFilters, isExplicitFiltering } from "./homeFilter";
import type { MediaFilters } from "./api";

function f(overrides: Partial<MediaFilters> = {}): MediaFilters {
  return {
    types: [],
    regions: [],
    statuses: [],
    genres: [],
    q: "",
    sort: "status",
    ...overrides,
  };
}

describe("isExplicitFiltering", () => {
  it("is false with no search and no facets", () => {
    expect(isExplicitFiltering(f())).toBe(false);
  });

  it("is false for a whitespace-only search", () => {
    expect(isExplicitFiltering(f({ q: "   " }))).toBe(false);
  });

  it("is true for any single facet or a real search", () => {
    expect(isExplicitFiltering(f({ q: "berserk" }))).toBe(true);
    expect(isExplicitFiltering(f({ types: ["manga"] }))).toBe(true);
    expect(isExplicitFiltering(f({ regions: ["japan"] }))).toBe(true);
    expect(isExplicitFiltering(f({ statuses: ["completed"] }))).toBe(true);
    expect(isExplicitFiltering(f({ genres: ["RPG"] }))).toBe(true);
  });
});

describe("effectiveLevelFilters", () => {
  it("injects status=in_progress at unfiltered Home", () => {
    const { filters, implicitHome } = effectiveLevelFilters(f(), null);
    expect(implicitHome).toBe(true);
    expect(filters.statuses).toEqual(["in_progress"]);
  });

  it("does not mutate the input filters", () => {
    const input = f();
    effectiveLevelFilters(input, null);
    expect(input.statuses).toEqual([]);
  });

  it("passes through untouched inside a collection (full contents)", () => {
    const input = f();
    const { filters, implicitHome } = effectiveLevelFilters(input, "col:abc");
    expect(implicitHome).toBe(false);
    expect(filters).toBe(input);
  });

  it("passes through untouched once the user filters or searches", () => {
    for (const input of [
      f({ types: ["animation"] }),
      f({ statuses: ["completed"] }),
      f({ q: "demon" }),
    ]) {
      const { filters, implicitHome } = effectiveLevelFilters(input, null);
      expect(implicitHome).toBe(false);
      expect(filters).toBe(input);
    }
  });
});
