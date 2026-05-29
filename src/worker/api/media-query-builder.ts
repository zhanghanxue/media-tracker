// FilterQueryBuilder (TESTING.md deep module) — pure. Turns validated
// ListFilters into a parameterized WHERE fragment + bind params + an ORDER BY
// clause. The repository assembles the final SELECT/COUNT around this.
//
// Security invariant: user-supplied VALUES only ever enter via `?` placeholders
// (returned in `params`), never string-interpolated into SQL. The only
// interpolation is the placeholder COUNT and the ORDER BY clause — both derived
// from server-controlled data (array length, sort whitelist), never user text.

import type { ListFilters, SortKey } from "./list-query";

export interface MediaListQuery {
  /** e.g. "WHERE type IN (?, ?) AND region IN (?)" — or "" when no filters. */
  where: string;
  /** Bind params for the WHERE clause, in placeholder order. */
  params: unknown[];
  /** Safe ORDER BY clause (no leading "ORDER BY"). */
  orderBy: string;
}

// Whitelist: maps the validated SortKey to a fixed, injection-safe clause.
// Title sort COALESCE order mirrors the display-title fallback (displayTitle.ts)
// for each language, so the list orders by the title the user actually sees.
const SORT_CLAUSES: Record<SortKey, string> = {
  date_updated: "date_updated DESC",
  date_added: "date_added DESC",
  title:
    "COALESCE(title_english, title_romaji, title_native, title_chinese) COLLATE NOCASE ASC",
  title_zh:
    "COALESCE(title_chinese, title_native, title_english, title_romaji) COLLATE NOCASE ASC",
};

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

// Escape LIKE wildcards in user input so a search for "50%" matches a literal
// "50%" rather than "starts with 50". Paired with `ESCAPE '\'` in the SQL.
function likePattern(q: string): string {
  const escaped = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

const TITLE_COLUMNS = [
  "title_native",
  "title_romaji",
  "title_english",
  "title_chinese",
] as const;

export function buildMediaListQuery(filters: ListFilters): MediaListQuery {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.types.length > 0) {
    clauses.push(`type IN (${placeholders(filters.types.length)})`);
    params.push(...filters.types);
  }

  if (filters.regions.length > 0) {
    clauses.push(`region IN (${placeholders(filters.regions.length)})`);
    params.push(...filters.regions);
  }

  if (filters.statuses.length > 0) {
    clauses.push(`status IN (${placeholders(filters.statuses.length)})`);
    params.push(...filters.statuses);
  }

  if (filters.q !== null) {
    // OR across the four title columns — match in any language counts.
    const likeOr = TITLE_COLUMNS.map(
      (col) => `${col} LIKE ? ESCAPE '\\'`,
    ).join(" OR ");
    clauses.push(`(${likeOr})`);
    const pattern = likePattern(filters.q);
    for (let i = 0; i < TITLE_COLUMNS.length; i++) params.push(pattern);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  return { where, params, orderBy: SORT_CLAUSES[filters.sort] };
}
