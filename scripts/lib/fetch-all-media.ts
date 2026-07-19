// Shared whole-library fetch for the backfill scripts.
//
// The backfills used to ask for `/api/media?limit=5000` and treat one response
// as the entire library. The server clamps `limit` to MAX_LIMIT (5000), so past
// that the tail is silently dropped — a backfill would report "done" having
// never seen the newest rows. This pages `offset` until it has the `total` the
// server reports.
//
// Safe to page because every sort ends in a unique `id` tiebreak (see
// api/media-query-builder), so no row straddles or slips between pages.
//
// Takes the caller's own `request` fn so each script keeps its auth/base-URL
// handling — the scripts don't share an HTTP client.

export interface MediaPage<T> {
  items: T[];
  total: number;
}

export type RequestFn = (
  method: string,
  path: string,
) => Promise<{ json: unknown }>;

/**
 * Every row in the library. `pageSize` stays under MAX_LIMIT so the server never
 * silently clamps. `onProgress` reports (fetched, total) after each page.
 */
export async function fetchAllMedia<T>(
  request: RequestFn,
  opts: { pageSize?: number; onProgress?: (got: number, total: number) => void } = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000;
  const out: T[] = [];
  let total = Infinity;
  for (let offset = 0; out.length < total; offset += pageSize) {
    const { json } = await request(
      "GET",
      `/api/media?limit=${pageSize}&offset=${offset}`,
    );
    const page = (json ?? { items: [], total: 0 }) as MediaPage<T>;
    total = page.total ?? 0;
    out.push(...(page.items ?? []));
    opts.onProgress?.(out.length, total);
    // Defensive: a short/empty page means there's nothing more, so stop rather
    // than spin forever if `total` and `items` ever disagree.
    if ((page.items ?? []).length < pageSize) break;
  }
  return out;
}
