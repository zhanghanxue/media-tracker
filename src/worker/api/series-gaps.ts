// Pure decision functions for the IGDB half of the collection-gap scan. No I/O —
// the route does the fetching, these decide what counts as a genuine missing
// entry in a game series. Pure → unit-tested.
//
// The rules mirror scripts/suggest-series-gaps.ts, minus its rating/vote
// thresholds. That script answers "what in this series is worth my time?", so it
// drops anything under 80/100. This scan answers a different question — "what
// else belongs in this collection?" — where a low-scoring sequel is still a
// member the user may want. Only STRUCTURAL noise is filtered.

import { igdbGameTypeId, type IgdbGame } from "../sources/igdb";

// Release kinds that are a genuine separate entry in a series: a main game (0),
// an expansion (2), or a standalone expansion (4). Everything else re-packages
// something already listed — DLC (1), bundle (3), remake (8), remaster (9),
// port (10), fork (11), pack (13), update (14) — and would clutter a collection
// with near-duplicates of what the user already has.
export const SERIES_ENTRY_TYPES = new Set([0, 2, 4]);

/**
 * Is this series member worth surfacing as a gap?
 *
 * Rejects:
 *   • alternate EDITIONS of another entry (Game of the Year, Deluxe) — they
 *     carry version_parent and duplicate their parent;
 *   • re-packagings (DLC, bundles, ports, remakes, …) per SERIES_ENTRY_TYPES;
 *   • entries with no release date at all — IGDB carries a long tail of
 *     announced-then-abandoned rows that would nag on every scan.
 *
 * An UNKNOWN release kind is kept: better a stray remaster than a silently
 * dropped sequel (the same call scripts/suggest-series-gaps.ts makes).
 */
export function isSeriesGapCandidate(game: IgdbGame): boolean {
  if (game.version_parent) return false;
  const kind = igdbGameTypeId(game);
  if (kind !== null && !SERIES_ENTRY_TYPES.has(kind)) return false;
  return !!game.first_release_date;
}

/** Series-gap candidates, newest release first. */
export function selectSeriesGaps(games: IgdbGame[]): IgdbGame[] {
  return games
    .filter(isSeriesGapCandidate)
    .sort((a, b) => (b.first_release_date ?? 0) - (a.first_release_date ?? 0));
}
