import { describe, expect, it } from "vitest";

import { buildMediaListQuery } from "./media-query-builder";
import type { ListFilters } from "./list-query";

// Base = "no filters". Each test overrides only what it exercises.
const BASE: ListFilters = {
  types: [],
  regions: [],
  statuses: [],
  q: null,
  sort: "date_updated",
  limit: 50,
  offset: 0,
};

function build(overrides: Partial<ListFilters>) {
  return buildMediaListQuery({ ...BASE, ...overrides });
}

describe("buildMediaListQuery — no filters", () => {
  it("produces an empty WHERE and no params", () => {
    const { where, params } = build({});
    expect(where).toBe("");
    expect(params).toEqual([]);
  });

  it("defaults ORDER BY to date_updated DESC", () => {
    expect(build({}).orderBy).toBe("date_updated DESC");
  });
});

describe("buildMediaListQuery — single facet (OR-within via IN)", () => {
  it("emits an IN list with one placeholder per value", () => {
    const { where, params } = build({ types: ["animation", "manga"] });
    expect(where).toBe("WHERE type IN (?, ?)");
    expect(params).toEqual(["animation", "manga"]);
  });

  it("binds region values as params, never interpolated", () => {
    const { where, params } = build({ regions: ["japan"] });
    expect(where).toBe("WHERE region IN (?)");
    expect(params).toEqual(["japan"]);
  });
});

describe("buildMediaListQuery — multiple facets (AND-across)", () => {
  it("joins facets with AND in declaration order, params aligned", () => {
    const { where, params } = build({
      types: ["animation"],
      regions: ["japan"],
      statuses: ["in_progress"],
    });
    expect(where).toBe(
      "WHERE type IN (?) AND region IN (?) AND status IN (?)",
    );
    expect(params).toEqual(["animation", "japan", "in_progress"]);
  });
});

describe("buildMediaListQuery — q (search across title columns)", () => {
  it("ORs a LIKE across all four title columns with one pattern each", () => {
    const { where, params } = build({ q: "demon" });
    expect(where).toBe(
      "WHERE (title_native LIKE ? ESCAPE '\\' OR title_romaji LIKE ? ESCAPE '\\' OR title_english LIKE ? ESCAPE '\\' OR title_chinese LIKE ? ESCAPE '\\')",
    );
    expect(params).toEqual(["%demon%", "%demon%", "%demon%", "%demon%"]);
  });

  it("escapes LIKE wildcards in the user query", () => {
    const { params } = build({ q: "50%_off" });
    // % and _ escaped with a backslash so they match literally.
    expect(params[0]).toBe("%50\\%\\_off%");
  });

  it("combines q with facets using AND", () => {
    const { where, params } = build({ types: ["manga"], q: "berserk" });
    expect(where).toBe(
      "WHERE type IN (?) AND (title_native LIKE ? ESCAPE '\\' OR title_romaji LIKE ? ESCAPE '\\' OR title_english LIKE ? ESCAPE '\\' OR title_chinese LIKE ? ESCAPE '\\')",
    );
    expect(params).toEqual([
      "manga",
      "%berserk%",
      "%berserk%",
      "%berserk%",
      "%berserk%",
    ]);
  });
});

describe("buildMediaListQuery — sort whitelist", () => {
  it("maps date_added", () => {
    expect(build({ sort: "date_added" }).orderBy).toBe("date_added DESC");
  });

  it("maps title to a COALESCE NOCASE clause", () => {
    expect(build({ sort: "title" }).orderBy).toBe(
      "COALESCE(title_english, title_romaji, title_native, title_chinese) COLLATE NOCASE ASC",
    );
  });
});
