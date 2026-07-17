import { describe, expect, it } from "vitest";

import { humanizeRegion, normalizeRegionSlug } from "./region";

describe("normalizeRegionSlug", () => {
  it("trims, lowercases, and underscores whitespace", () => {
    expect(normalizeRegionSlug("  Poland ")).toBe("poland");
    expect(normalizeRegionSlug("Hong Kong")).toBe("hong_kong");
    expect(normalizeRegionSlug("South   Korea")).toBe("south_korea");
  });
  it("passes CJK input through unchanged", () => {
    expect(normalizeRegionSlug("波兰")).toBe("波兰");
  });
  it("empty / whitespace-only input becomes the empty string (region unset)", () => {
    expect(normalizeRegionSlug("   ")).toBe("");
  });
});

describe("humanizeRegion", () => {
  it("title-cases underscore slugs for display", () => {
    expect(humanizeRegion("poland")).toBe("Poland");
    expect(humanizeRegion("hong_kong")).toBe("Hong Kong");
  });
  it("leaves CJK values as-is", () => {
    expect(humanizeRegion("波兰")).toBe("波兰");
  });
});
