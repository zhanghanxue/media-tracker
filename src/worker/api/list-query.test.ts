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
        genres: [],
        q: null,
        collection: null,
        sort: "date_updated",
        limit: 50,
        offset: 0,
        ids: [],
      },
    });
  });

  it("parses a collection scope (id and the __root__ sentinel)", () => {
    const byId = parse({ collection: "col:abc" });
    expect(byId.ok).toBe(true);
    if (byId.ok) expect(byId.value.collection).toBe("col:abc");

    const root = parse({ collection: "__root__" });
    expect(root.ok).toBe(true);
    if (root.ok) expect(root.value.collection).toBe("__root__");

    const none = parse({});
    if (none.ok) expect(none.value.collection).toBeNull();
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

  it("keeps genre values (open-ended, OR-within)", () => {
    const result = parse({ genre: ["RPG", "Mystery", "  "] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.genres).toEqual(["RPG", "Mystery"]);
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

describe("parseListQuery — id", () => {
  it("parses repeated ids as integers", () => {
    const result = parse({ id: ["3", "17"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ids).toEqual([3, 17]);
  });

  it("defaults to no id restriction", () => {
    const result = parse({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ids).toEqual([]);
  });

  it("rejects non-numeric and non-positive ids", () => {
    for (const bad of ["abc", "0", "-1", "1.5"]) {
      const result = parse({ id: [bad] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toContain("invalid id(s)");
    }
  });
});

describe("parseListQuery — sort", () => {
  it("accepts the Feature D reverse sort keys", () => {
    for (const s of ["release_date_desc", "title_desc", "title_zh_desc"]) {
      const result = parse({ sort: s });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.sort).toBe(s);
    }
  });

  it("accepts a whitelisted sort", () => {
    const result = parse({ sort: "date_added" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sort).toBe("date_added");
  });

  it("accepts the status-priority sort", () => {
    const result = parse({ sort: "status" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sort).toBe("status");
  });

  it("rejects an unknown sort", () => {
    const result = parse({ sort: "rating" });
    expect(result.ok).toBe(false);
  });
});

describe("parseListQuery — limit & offset", () => {
  it("clamps limit to the max (raised to clear the whole library)", () => {
    const result = parse({ limit: "999999" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.limit).toBe(5000);
  });

  it("keeps a 5000-row library page request (the client's full-library fetch)", () => {
    const result = parse({ limit: "5000" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.limit).toBe(5000);
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
