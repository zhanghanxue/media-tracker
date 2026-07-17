// Query-string parsing + validation for GET /api/media. Pure — no I/O — so it's
// unit-tested in the node project. The handler extracts the raw param shape
// from Hono (c.req.queries / c.req.query) and hands it here; the validated
// ListFilters then feed the (also pure) media-query-builder.
//
// Facet semantics (per DESIGN.md §14): AND *across* facets, OR *within* one.
// e.g. ?type=animation&type=manga&region=japan
//   => (type IN ('animation','manga')) AND (region IN ('japan'))

import type { MediaStatus, MediaType } from "../db/schema";
import { MEDIA_STATUSES, MEDIA_TYPES } from "./validation";

// `title` sorts English-first; `title_zh` sorts Chinese-first — the client
// picks which when the UI language is English vs Chinese (same "Title A–Z"
// control), so ordering matches the titles actually displayed.
// PRD-v2 Feature D adds the reverse directions: release_date_desc (newest first)
// and title_desc / title_zh_desc (Z–A), so every sort has both directions.
export const SORT_KEYS = [
  // Groups by status priority (in progress → planned → completed → dropped →
  // paused), newest activity first within each group. The client's default.
  "status",
  "date_updated",
  "date_added",
  "release_date",
  "release_date_desc",
  "title",
  "title_desc",
  "title_zh",
  "title_zh_desc",
  // Feature D — by the source's rating (0–10). Unrated rows sort last either way.
  "rating_desc",
  "rating_asc",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const DEFAULT_SORT: SortKey = "date_updated";

// Rank order behind the `status` sort. Shared with the client (imported by
// MediaList's interleave, same cross-import pattern as SortKey) so the
// collection-card slotting always matches the server's ORDER BY.
export const STATUS_SORT_PRIORITY: Record<MediaStatus, number> = {
  in_progress: 0,
  planned: 1,
  completed: 2,
  dropped: 3,
  paused: 4,
};
export const DEFAULT_LIMIT = 50;
// The client fetches the WHOLE library in one page (client-side pinyin collation
// + series grouping both need every row). After the bulk import that's ~1.2k+
// rows, so the cap has to clear it — at 200 most of the library was invisible.
export const MAX_LIMIT = 5000;
export const DEFAULT_OFFSET = 0;

export interface ListFilters {
  // Explicit row ids (repeatable `id` param). Used by the client to keep
  // specific rows fresh (e.g. session-added pins) regardless of any other
  // scope; empty = no id restriction.
  ids: number[];
  types: MediaType[];
  // Open-ended (DESIGN: region accepts any ISO fallback string), so no enum
  // check — only emptiness filtering. The sentinel REGION_UNSET selects rows
  // whose region IS NULL/empty (the "fix these by hand" bucket).
  regions: string[];
  statuses: MediaStatus[];
  // Genre names (source-native), open-ended like regions. Matched against the
  // sentinel-delimited `genres` column.
  genres: string[];
  q: string | null;
  // Collection scope (drill-down): a collection id restricts to items sitting
  // DIRECTLY in it; the COLLECTION_ROOT sentinel restricts to loose items (no
  // collection). null = no collection scoping (whole library, the old behavior).
  collection: string | null;
  sort: SortKey;
  limit: number;
  offset: number;
}

// Region facet value that means "no region set". Picked so it can't collide
// with a real region string.
export const REGION_UNSET = "__unset__";

// Collection scope value that means "loose items, in no collection" (the root
// level of the drill-down). Picked so it can't collide with a real collection id.
export const COLLECTION_ROOT = "__root__";

/** Raw, pre-validation shape the handler pulls off the request. */
export interface RawListQuery {
  id?: string[];
  type?: string[];
  region?: string[];
  status?: string[];
  genre?: string[];
  q?: string;
  collection?: string;
  sort?: string;
  limit?: string;
  offset?: string;
}

export type ListQueryResult =
  | { ok: true; value: ListFilters }
  | { ok: false; errors: string[] };

/** Parse a non-negative (or, for limit, positive) integer, or null if invalid. */
function parseInteger(raw: string, { min }: { min: number }): number | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return n >= min ? n : null;
}

export function parseListQuery(raw: RawListQuery): ListQueryResult {
  const errors: string[] = [];

  const rawIds = (raw.id ?? []).map((v) => v.trim()).filter(Boolean);
  const badIds = rawIds.filter((v) => !/^[1-9][0-9]*$/.test(v));
  if (badIds.length > 0) {
    errors.push(`invalid id(s): ${badIds.join(", ")}`);
  }
  const ids = rawIds.map((v) => Number.parseInt(v, 10));

  const types = (raw.type ?? []).map((t) => t.trim()).filter(Boolean);
  const badTypes = types.filter((t) => !MEDIA_TYPES.includes(t as MediaType));
  if (badTypes.length > 0) {
    errors.push(`invalid type(s): ${badTypes.join(", ")}`);
  }

  const statuses = (raw.status ?? []).map((s) => s.trim()).filter(Boolean);
  const badStatuses = statuses.filter(
    (s) => !MEDIA_STATUSES.includes(s as MediaStatus),
  );
  if (badStatuses.length > 0) {
    errors.push(`invalid status(es): ${badStatuses.join(", ")}`);
  }

  // Regions are open-ended; just drop empties.
  const regions = (raw.region ?? []).map((r) => r.trim()).filter(Boolean);

  // Genres open-ended like regions; drop empties.
  const genres = (raw.genre ?? []).map((g) => g.trim()).filter(Boolean);

  const trimmedQ = raw.q?.trim() ?? "";
  const q = trimmedQ.length > 0 ? trimmedQ : null;

  // Collection scope: a real id, the COLLECTION_ROOT sentinel, or null (unscoped).
  const trimmedCollection = raw.collection?.trim() ?? "";
  const collection = trimmedCollection.length > 0 ? trimmedCollection : null;

  let sort: SortKey = DEFAULT_SORT;
  if (raw.sort !== undefined) {
    if (!SORT_KEYS.includes(raw.sort as SortKey)) {
      errors.push(`sort must be one of: ${SORT_KEYS.join(", ")}`);
    } else {
      sort = raw.sort as SortKey;
    }
  }

  let limit = DEFAULT_LIMIT;
  if (raw.limit !== undefined) {
    const parsed = parseInteger(raw.limit, { min: 1 });
    if (parsed === null) {
      errors.push("limit must be a positive integer");
    } else {
      // Clamp rather than reject: an over-large page size is a soft cap, not a
      // client error.
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  let offset = DEFAULT_OFFSET;
  if (raw.offset !== undefined) {
    const parsed = parseInteger(raw.offset, { min: 0 });
    if (parsed === null) {
      errors.push("offset must be a non-negative integer");
    } else {
      offset = parsed;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      ids,
      types: types as MediaType[],
      regions,
      statuses: statuses as MediaStatus[],
      genres,
      q,
      collection,
      sort,
      limit,
      offset,
    },
  };
}
