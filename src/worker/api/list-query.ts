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
export const SORT_KEYS = [
  "date_updated",
  "date_added",
  "title",
  "title_zh",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const DEFAULT_SORT: SortKey = "date_updated";
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const DEFAULT_OFFSET = 0;

export interface ListFilters {
  types: MediaType[];
  // Open-ended (DESIGN: region accepts any ISO fallback string), so no enum
  // check — only emptiness filtering.
  regions: string[];
  statuses: MediaStatus[];
  q: string | null;
  sort: SortKey;
  limit: number;
  offset: number;
}

/** Raw, pre-validation shape the handler pulls off the request. */
export interface RawListQuery {
  type?: string[];
  region?: string[];
  status?: string[];
  q?: string;
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

  const trimmedQ = raw.q?.trim() ?? "";
  const q = trimmedQ.length > 0 ? trimmedQ : null;

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
      types: types as MediaType[],
      regions,
      statuses: statuses as MediaStatus[],
      q,
      sort,
      limit,
      offset,
    },
  };
}
