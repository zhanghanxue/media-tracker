import { describe, expect, it } from "vitest";

import { buildMediaListQuery } from "./media-query-builder";
import type { ListFilters } from "./list-query";

// Base = "no filters". Each test overrides only what it exercises.
const BASE: ListFilters = {
  ids: [],
  types: [],
  regions: [],
  statuses: [],
  genres: [],
  q: null,
  collection: null,
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
    expect(build({}).orderBy).toBe("date_updated DESC, id ASC");
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

describe("buildMediaListQuery — genres (OR-within)", () => {
  it("ORs a sentinel-wrapped LIKE per selected genre", () => {
    const { where, params } = build({ genres: ["RPG", "Action"] });
    expect(where).toBe(
      "WHERE (genres LIKE ? ESCAPE '\\' OR genres LIKE ? ESCAPE '\\')",
    );
    expect(params).toEqual(["%|RPG|%", "%|Action|%"]);
  });

  it("ANDs genres with other facets", () => {
    const { where, params } = build({ types: ["game"], genres: ["RPG"] });
    expect(where).toBe("WHERE type IN (?) AND (genres LIKE ? ESCAPE '\\')");
    expect(params).toEqual(["game", "%|RPG|%"]);
  });
});

describe("buildMediaListQuery — region __unset__ sentinel", () => {
  it("turns the lone sentinel into an IS NULL / empty test (no params)", () => {
    const { where, params } = build({ regions: ["__unset__"] });
    expect(where).toBe("WHERE (region IS NULL OR region = '')");
    expect(params).toEqual([]);
  });

  it("ORs the sentinel with real regions", () => {
    const { where, params } = build({ regions: ["japan", "__unset__"] });
    expect(where).toBe("WHERE (region IN (?) OR region IS NULL OR region = '')");
    expect(params).toEqual(["japan"]);
  });

  it("real regions alone stay a plain IN (...) (no parens)", () => {
    const { where, params } = build({ regions: ["japan", "china"] });
    expect(where).toBe("WHERE region IN (?, ?)");
    expect(params).toEqual(["japan", "china"]);
  });
});

describe("buildMediaListQuery — explicit ids", () => {
  it("emits an id IN list with bound params", () => {
    const { where, params } = build({ ids: [3, 17] });
    expect(where).toBe("WHERE id IN (?, ?)");
    expect(params).toEqual([3, 17]);
  });

  it("ANDs ids with other facets, params in clause order", () => {
    const { where, params } = build({ ids: [5], types: ["manga"] });
    expect(where).toBe("WHERE id IN (?) AND type IN (?)");
    expect(params).toEqual([5, "manga"]);
  });
});

describe("buildMediaListQuery — collection scope", () => {
  it("scopes to a named collection by id (parameterized)", () => {
    const { where, params } = build({ collection: "col:abc" });
    expect(where).toBe("WHERE collection_id = ?");
    expect(params).toEqual(["col:abc"]);
  });

  it("scopes to loose (no-collection) items at the root sentinel", () => {
    const { where, params } = build({ collection: "__root__" });
    expect(where).toBe("WHERE collection_id IS NULL");
    expect(params).toEqual([]);
  });

  it("adds no collection clause when unscoped (null)", () => {
    expect(build({ collection: null }).where).toBe("");
  });

  it("ANDs the collection scope with other facets", () => {
    const { where, params } = build({
      collection: "col:x",
      statuses: ["completed"],
    });
    expect(where).toBe("WHERE status IN (?) AND collection_id = ?");
    expect(params).toEqual(["completed", "col:x"]);
  });
});

describe("buildMediaListQuery — sort whitelist", () => {
  it("maps date_added", () => {
    expect(build({ sort: "date_added" }).orderBy).toBe("date_added DESC, id ASC");
  });

  it("maps status to a priority CASE, newest activity within each group", () => {
    expect(build({ sort: "status" }).orderBy).toBe(
      "CASE status WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 WHEN 'completed' THEN 2 WHEN 'dropped' THEN 3 WHEN 'paused' THEN 4 ELSE 99 END ASC, date_updated DESC, id ASC",
    );
  });

  it("maps title to a COALESCE NOCASE clause (English-first)", () => {
    expect(build({ sort: "title" }).orderBy).toBe(
      "COALESCE(title_english, title_romaji, title_native, title_chinese) COLLATE NOCASE ASC, id ASC",
    );
  });

  it("maps title_zh to the pinyin key, falling back to the Chinese-first COALESCE", () => {
    expect(build({ sort: "title_zh" }).orderBy).toBe(
      "COALESCE(title_sort_zh, title_chinese, title_native, title_english, title_romaji) COLLATE NOCASE ASC, id ASC",
    );
  });

  it("maps release_date to oldest-first with nulls last", () => {
    expect(build({ sort: "release_date" }).orderBy).toBe(
      "release_date IS NULL, release_date ASC, id ASC",
    );
  });

  // Feature D — reverse directions. Undated rows still sort LAST in both.
  it("maps release_date_desc to newest-first with nulls still last", () => {
    expect(build({ sort: "release_date_desc" }).orderBy).toBe(
      "release_date IS NULL, release_date DESC, id ASC",
    );
  });

  it("maps title_desc to a COALESCE NOCASE DESC clause (English-first)", () => {
    expect(build({ sort: "title_desc" }).orderBy).toBe(
      "COALESCE(title_english, title_romaji, title_native, title_chinese) COLLATE NOCASE DESC, id ASC",
    );
  });

  it("maps title_zh_desc to the pinyin key, falling back to the Chinese-first COALESCE", () => {
    expect(build({ sort: "title_zh_desc" }).orderBy).toBe(
      "COALESCE(title_sort_zh, title_chinese, title_native, title_english, title_romaji) COLLATE NOCASE DESC, id ASC",
    );
  });

  // Pagination correctness: every sort must end in a UNIQUE key, else tied rows
  // (same second, same title, the whole undated tail) can land on two pages or
  // none as a caller walks LIMIT/OFFSET.
  it("ends every sort with the id tiebreak so paging is stable", () => {
    const sorts = [
      "status",
      "date_updated",
      "date_added",
      "release_date",
      "release_date_desc",
      "title",
      "title_desc",
      "title_zh",
      "title_zh_desc",
    ] as const;
    for (const sort of sorts) {
      expect(build({ sort }).orderBy.endsWith(", id ASC")).toBe(true);
    }
  });
});
