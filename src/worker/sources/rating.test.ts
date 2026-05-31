import { describe, it, expect } from "vitest";
import { ratingFrom100, ratingFrom10 } from "./rating";

describe("ratingFrom100 (AniList / IGDB 0–100)", () => {
  it("scales to one decimal", () => {
    expect(ratingFrom100(83)).toBe(8.3);
    expect(ratingFrom100(100)).toBe(10);
    expect(ratingFrom100(7)).toBe(0.7);
  });

  it("treats 0 / null / undefined / NaN as unrated", () => {
    expect(ratingFrom100(0)).toBeNull();
    expect(ratingFrom100(null)).toBeNull();
    expect(ratingFrom100(undefined)).toBeNull();
    expect(ratingFrom100(Number.NaN)).toBeNull();
  });
});

describe("ratingFrom10 (TMDB / Bangumi 0–10)", () => {
  it("passes through, guarding stray precision", () => {
    expect(ratingFrom10(8.4)).toBe(8.4);
    expect(ratingFrom10(8.400001)).toBe(8.4);
    expect(ratingFrom10(10)).toBe(10);
  });

  it("treats 0 / null / undefined as unrated", () => {
    expect(ratingFrom10(0)).toBeNull();
    expect(ratingFrom10(null)).toBeNull();
    expect(ratingFrom10(undefined)).toBeNull();
  });
});
