import { describe, expect, it } from "vitest";

import { parseListQuery, type RawListQuery } from "./list-query";

function parse(raw: RawListQuery) {
  return parseListQuery(raw);
}

describe("parseListQuery — defaults", () => {
  it("applies defaults for an empty query", () => {
    const result = parse({});
    expect(result).toEqual({
      ok: true,
      value: {
        types: [],
        regions: [],
        statuses: [],
        q: null,
        sort: "date_updated",
        limit: 50,
        offset: 0,
      },
    });
  });
});

describe("parseListQuery — facets", () => {
  it("keeps multiple values for a repeatable facet (OR-within)", () => {
    const result = parse({ type: ["animation", "manga"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.types).toEqual(["animation", "manga"]);
  });

  it("accepts arbitrary region strings (open-ended, no enum check)", () => {
    const result = parse({ region: ["japan", "th", "made-up-place"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.regions).toEqual(["japan", "th", "made-up-place"]);
    }
  });

  it("drops empty/whitespace facet values", () => {
    const result = parse({ type: ["animation", "  ", ""] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.types).toEqual(["animation"]);
  });

  it("rejects an unknown type", () => {
    const result = parse({ type: ["animation", "podcast"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("podcast"))).toBe(true);
    }
  });

  it("rejects an unknown status", () => {
    const result = parse({ status: ["banana"] });
    expect(result.ok).toBe(false);
  });
});

describe("parseListQuery — q", () => {
  it("trims q and keeps it", () => {
    const result = parse({ q: "  demon  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.q).toBe("demon");
  });

  it("treats an all-whitespace q as null", () => {
    const result = parse({ q: "   " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.q).toBeNull();
  });
});

describe("parseListQuery — sort", () => {
  it("accepts a whitelisted sort", () => {
    const result = parse({ sort: "date_added" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sort).toBe("date_added");
  });

  it("rejects an unknown sort", () => {
    const result = parse({ sort: "rating" });
    expect(result.ok).toBe(false);
  });
});

describe("parseListQuery — limit & offset", () => {
  it("clamps limit to the max of 200", () => {
    const result = parse({ limit: "500" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.limit).toBe(200);
  });

  it("keeps a valid in-range limit", () => {
    const result = parse({ limit: "25" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.limit).toBe(25);
  });

  it("rejects limit = 0 and non-numeric limit", () => {
    expect(parse({ limit: "0" }).ok).toBe(false);
    expect(parse({ limit: "abc" }).ok).toBe(false);
    expect(parse({ limit: "-5" }).ok).toBe(false);
  });

  it("accepts offset = 0 and positive offsets", () => {
    const result = parse({ offset: "0" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.offset).toBe(0);
  });

  it("rejects a negative or non-numeric offset", () => {
    expect(parse({ offset: "-1" }).ok).toBe(false);
    expect(parse({ offset: "x" }).ok).toBe(false);
  });
});

describe("parseListQuery — collects all errors", () => {
  it("reports every invalid field at once", () => {
    const result = parse({
      type: ["podcast"],
      status: ["banana"],
      sort: "rating",
      limit: "0",
      offset: "-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(5);
    }
  });
});
