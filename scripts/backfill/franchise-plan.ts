// Pure decision logic for the franchise backfill (scripts/backfill-collections.ts).
// Kept apart from the script so it's testable without network or a live library —
// same split as scripts/import/*.ts.

/** The library-row fields the plan needs. */
export interface PlanRow {
  id: number;
  type: string;
  collection_id: string | null;
  external_source: string | null;
  external_id: string | null;
  igdb_id: string | null;
  tmdb_id: string | null;
}

/**
 * A movie's TMDB id: the primary source id when TMDB-sourced, else the `tmdb_id`
 * cross-reference. BOTH are kind-prefixed ("movie:1366" / "tv:1399"), so a "tv:"
 * value is a show or season — never a film franchise — and is rejected. A bare
 * numeric id (older rows) is accepted as a movie id.
 */
export function tmdbMovieIdOf(row: PlanRow): number | null {
  const raw = (
    row.external_source === "tmdb" ? row.external_id : row.tmdb_id
  )?.trim();
  if (!raw) return null;
  if (raw.startsWith("tv:")) return null;
  const id = Number(raw.replace(/^movie:/, ""));
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** A game's IGDB id: its primary source id when IGDB-sourced, else the xref. */
export function igdbIdOf(row: PlanRow): number | null {
  const raw = row.external_source === "igdb" ? row.external_id : row.igdb_id;
  const id = Number(raw);
  return raw && Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Rows the backfill will look up: ungrouped movies/games carrying a usable
 * source link. Anything already in a collection is left alone — a hand-made
 * grouping must never be moved.
 */
export function selectCandidates(
  rows: PlanRow[],
  opts: { movies: boolean; games: boolean },
): PlanRow[] {
  return rows.filter(
    (r) =>
      r.collection_id === null &&
      ((opts.movies && r.type === "movie" && tmdbMovieIdOf(r) !== null) ||
        (opts.games && r.type === "game" && igdbIdOf(r) !== null)),
  );
}

export interface Group<T> {
  rows: T[];
  name: string | null;
}

/**
 * Split derived franchises into the ones worth filing and the ones to skip.
 *
 * A franchise is actionable when it has **≥2 loose members** — a one-film
 * "collection" is noise, not grouping — OR when the collection already exists
 * (a recent add minted it), in which case a lone straggler should join it.
 */
export function partitionGroups<T>(
  groups: Map<string, Group<T>>,
  existingIds: ReadonlySet<string>,
): { actionable: [string, Group<T>][]; singletons: [string, Group<T>][] } {
  const actionable: [string, Group<T>][] = [];
  const singletons: [string, Group<T>][] = [];
  for (const entry of groups) {
    const [key, g] = entry;
    if (g.rows.length >= 2 || existingIds.has(key)) actionable.push(entry);
    else singletons.push(entry);
  }
  return { actionable, singletons };
}
