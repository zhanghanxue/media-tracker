import { describe, expect, it } from "vitest";

import {
  isoFromParts,
  isoFromString,
  isoFromUnixSeconds,
} from "./release-date";

describe("isoFromParts", () => {
  it("builds a full date from year/month/day", () => {
    expect(isoFromParts(2026, 4, 17)).toBe("2026-04-17");
  });

  it("zero-pads month and day", () => {
    expect(isoFromParts(2026, 1, 9)).toBe("2026-01-09");
  });

  it("pads a year-only value to Jan 1", () => {
    expect(isoFromParts(1999)).toBe("1999-01-01");
  });

  it("pads year+month to the 1st", () => {
    expect(isoFromParts(2024, 12, null)).toBe("2024-12-01");
  });

  it("ignores out-of-range month/day, falling back to 01", () => {
    expect(isoFromParts(2026, 0, 0)).toBe("2026-01-01");
    expect(isoFromParts(2026, 13, 40)).toBe("2026-01-01");
  });

  it("returns null without a usable year", () => {
    expect(isoFromParts(null)).toBeNull();
    expect(isoFromParts(undefined)).toBeNull();
    expect(isoFromParts(0)).toBeNull();
  });

  it("sorts a year-only value before a dated one in the same year", () => {
    expect(isoFromParts(2026)! < isoFromParts(2026, 4, 17)!).toBe(true);
  });
});

describe("isoFromString", () => {
  it("passes a full ISO date through", () => {
    expect(isoFromString("2026-04-17")).toBe("2026-04-17");
  });

  it("pads a year-month string", () => {
    expect(isoFromString("2024-12")).toBe("2024-12-01");
  });

  it("pads a year-only string", () => {
    expect(isoFromString("2024")).toBe("2024-01-01");
  });

  it("zero-pads single-digit month/day from the source", () => {
    expect(isoFromString("2024-3-5")).toBe("2024-03-05");
  });

  it("trims surrounding whitespace", () => {
    expect(isoFromString("  2026-04-17  ")).toBe("2026-04-17");
  });

  it("returns null for blank or malformed input", () => {
    expect(isoFromString("")).toBeNull();
    expect(isoFromString(null)).toBeNull();
    expect(isoFromString(undefined)).toBeNull();
    expect(isoFromString("TBA")).toBeNull();
  });
});

describe("isoFromUnixSeconds", () => {
  it("converts a Unix second timestamp to a UTC date", () => {
    // 2026-04-17T00:00:00Z = 1776384000
    expect(isoFromUnixSeconds(1776384000)).toBe("2026-04-17");
  });

  it("handles the epoch", () => {
    expect(isoFromUnixSeconds(0)).toBe("1970-01-01");
  });

  it("returns null for missing/non-finite input", () => {
    expect(isoFromUnixSeconds(null)).toBeNull();
    expect(isoFromUnixSeconds(undefined)).toBeNull();
    expect(isoFromUnixSeconds(Number.NaN)).toBeNull();
  });
});
