// Feature A ("What's New" scanner) — pure decision functions. No I/O: the browser
// does the fetching (TMDB seasons via the Worker proxy, AniList relations direct),
// these decide what counts as a genuinely-new season / sequel. Pure → unit-tested.

// A TMDB season as the seasons endpoint returns it (mirrors client TmdbSeason).
export interface SeasonInfo {
  season_number: number;
  name: string | null;
  episode_count: number | null;
  air_date: string | null;
  poster_path: string | null;
}

/**
 * New TMDB seasons of a show: those in `available` whose season_number isn't in
 * `ownedSeasonNumbers`. Excludes the season-0 "specials" bucket and unaired/
 * placeholder seasons (no air_date) — you can't watch what hasn't aired, and an
 * announced-but-undated season would nag every scan. Sorted by season_number.
 */
export function diffTmdbSeasons(
  ownedSeasonNumbers: number[],
  available: SeasonInfo[],
): SeasonInfo[] {
  const owned = new Set(ownedSeasonNumbers);
  return available
    .filter(
      (s) => s.season_number >= 1 && !!s.air_date && !owned.has(s.season_number),
    )
    .sort((a, b) => a.season_number - b.season_number);
}

// An AniList relation edge (subset of getAniListRelations' shape) — the fields the
// sequel walk needs.
export interface RelationEdge {
  relationType: string;
  node: { id: number; type: string | null; format: string | null };
}

// A sequel candidate the scan surfaces.
export interface SequelCandidate {
  id: number;
  format: string | null;
}

// Season-like sequel formats only — a SEQUEL that's a recap MOVIE / OVA / MUSIC
// isn't a "next season" in the sense the user means, so we don't surface it.
const SEASON_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);

/**
 * New AniList sequels of an anime: direct SEQUEL edges whose target is a
 * season-like format AND isn't already in the library. `ownedAniListIds` is the
 * set of AniList ids the library holds (as strings). Dedupes by id.
 */
export function findNewSequels(
  edges: RelationEdge[],
  ownedAniListIds: Set<string>,
): SequelCandidate[] {
  const out: SequelCandidate[] = [];
  const seen = new Set<number>();
  for (const e of edges) {
    if (e.relationType !== "SEQUEL") continue;
    if (e.node.format && !SEASON_FORMATS.has(e.node.format)) continue;
    if (ownedAniListIds.has(String(e.node.id))) continue;
    if (seen.has(e.node.id)) continue;
    seen.add(e.node.id);
    out.push({ id: e.node.id, format: e.node.format });
  }
  return out;
}
