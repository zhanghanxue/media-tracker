// FilterQueryBuilder (TESTING.md deep module) — pure. Turns validated
// ListFilters into a parameterized WHERE fragment + bind params + an ORDER BY
// clause. The repository assembles the final SELECT/COUNT around this.
//
// Security invariant: user-supplied VALUES only ever enter via `?` placeholders
// (returned in `params`), never string-interpolated into SQL. The only
// interpolation is the placeholder COUNT and the ORDER BY clause — both derived
// from server-controlled data (array length, sort whitelist), never user text.

import { genreLikePattern } from "../sources/genres";
import {
  COLLECTION_ROOT,
  REGION_UNSET,
  type ListFilters,
  type SortKey,
} from "./list-query";

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
  // Chronological by the work's actual air/release date, oldest first (so a
  // collection reads in release order). Rows with no known date sort last:
  // `release_date IS NULL` is 0 for dated rows, 1 for undated → ASC puts the
  // dated ones first.
  release_date: "release_date IS NULL, release_date ASC",
  // Feature D: newest first. `release_date IS NULL` stays the FIRST term so
  // undated rows still sort LAST (not first) — only the dated tail flips to DESC.
  release_date_desc: "release_date IS NULL, release_date DESC",
  title:
    "COALESCE(title_english, title_romaji, title_native, title_chinese) COLLATE NOCASE ASC",
  // Feature D: Z–A, same COALESCE fallback as `title`.
  title_desc:
    "COALESCE(title_english, title_romaji, title_native, title_chinese) COLLATE NOCASE DESC",
  title_zh:
    "COALESCE(title_chinese, title_native, title_english, title_romaji) COLLATE NOCASE ASC",
  title_zh_desc:
    "COALESCE(title_chinese, title_native, title_english, title_romaji) COLLATE NOCASE DESC",
  // Feature D: by the source's 0–10 rating. `source_rating IS NULL` first keeps
  // unrated rows LAST in both directions (same NULLs-last pattern as release_date).
  rating_desc: "source_rating IS NULL, source_rating DESC",
  rating_asc: "source_rating IS NULL, source_rating ASC",
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
    // Split the sentinel ("no region set") from real region values. With no
    // sentinel the clause stays a plain `region IN (...)`; the sentinel adds an
    // OR'd `region IS NULL OR region = ''` and the whole thing is parenthesized.
    const real = filters.regions.filter((r) => r !== REGION_UNSET);
    const wantsUnset = filters.regions.includes(REGION_UNSET);
    if (real.length > 0 && !wantsUnset) {
      clauses.push(`region IN (${placeholders(real.length)})`);
      params.push(...real);
    } else {
      const ors: string[] = [];
      if (real.length > 0) {
        ors.push(`region IN (${placeholders(real.length)})`);
        params.push(...real);
      }
      if (wantsUnset) ors.push("region IS NULL OR region = ''");
      clauses.push(`(${ors.join(" OR ")})`);
    }
  }

  if (filters.statuses.length > 0) {
    clauses.push(`status IN (${placeholders(filters.statuses.length)})`);
    params.push(...filters.statuses);
  }

  if (filters.genres.length > 0) {
    // OR within: a row matches if its genre set contains ANY selected genre.
    // Sentinel-wrapped LIKE so "RPG" can't false-match a genre containing it.
    const likeOr = filters.genres
      .map(() => `genres LIKE ? ESCAPE '\\'`)
      .join(" OR ");
    clauses.push(`(${likeOr})`);
    for (const g of filters.genres) params.push(genreLikePattern(g));
  }

  if (filters.collection !== null) {
    // Drill-down scope: loose items (no collection) at the root level, else the
    // items sitting directly in the named collection.
    if (filters.collection === COLLECTION_ROOT) {
      clauses.push("collection_id IS NULL");
    } else {
      clauses.push("collection_id = ?");
      params.push(filters.collection);
    }
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
