// Home-view filter policy (pure, unit-tested — MediaList just wires it up).
//
// The default (root, unfiltered) view shows only what's actually being
// watched/read/played: an IMPLICIT status=in_progress filter. It applies only
// when the user hasn't asked for anything else — no search, no facet — and
// only at Home. Drilling into a collection always shows the collection's full
// contents, and any explicit filter/search browses the whole library.

import type { MediaFilters } from "./api";

/** True when the user has explicitly narrowed the view (search or any facet). */
export function isExplicitFiltering(f: MediaFilters): boolean {
  return (
    f.q.trim() !== "" ||
    f.types.length + f.regions.length + f.statuses.length + f.genres.length > 0
  );
}

/**
 * The filters the level query should actually run with. At Home with nothing
 * explicitly selected, inject status=in_progress (`implicitHome: true`);
 * everywhere else, pass the user's filters through untouched.
 */
export function effectiveLevelFilters(
  f: MediaFilters,
  currentId: string | null,
): { filters: MediaFilters; implicitHome: boolean } {
  const implicitHome = currentId === null && !isExplicitFiltering(f);
  if (!implicitHome) return { filters: f, implicitHome };
  return { filters: { ...f, statuses: ["in_progress"] }, implicitHome };
}
