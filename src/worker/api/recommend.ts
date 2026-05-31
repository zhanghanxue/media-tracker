// Feature B (Recommendations) — pure aggregation & ranking, plus the seed-id
// resolver. No I/O here: the source clients (TMDB / IGDB / AniList) produce a flat
// list of RecCandidate (one entry per seed that surfaced a candidate); this tallies
// them, drops anything already in the library, and ranks. Pure → unit-testable and
// reusable by BOTH the worker (movie/drama/variety/game) and the browser (anime,
// since AniList is browser-side), mirroring how the add flow splits the sources.

export interface RecCandidate {
  /** Source the candidate (and its id) belongs to: 'anilist' | 'tmdb' | 'igdb'. */
  source: string;
  /** Source-native id. For TMDB it's kind-prefixed ("movie:603") to match how the
   *  library stores external_id, so library-exclusion compares like-for-like. */
  id: string;
  title: string;
  coverUrl: string | null;
  /** Source-provided affinity (TMDB vote_average, IGDB/AniList rating). Tiebreak. */
  score: number;
  /** Title of the OWNED item that surfaced this candidate — the "why". */
  seedTitle: string;
}

export interface RankedRecommendation {
  source: string;
  id: string;
  title: string;
  coverUrl: string | null;
  /** How many distinct seeds surfaced this candidate — the primary ranking signal. */
  count: number;
  /** Single-seed attribution ("because you have …"), per the v2.0 decision. */
  becauseTitle: string;
}

export interface AggregateOptions {
  /** Library ids to exclude, each keyed `${source}:${id}` (matches RecCandidate). */
  excludedIds: Set<string>;
  /** Normalized titles already in the library, to catch cross-source dupes. */
  excludedTitles: Set<string>;
  /** Title normalizer (injected so this module needn't import the source mappers). */
  normalize: (title: string) => string;
  limit: number;
}

export function aggregateRecommendations(
  candidates: RecCandidate[],
  opts: AggregateOptions,
): RankedRecommendation[] {
  const { excludedIds, excludedTitles, normalize, limit } = opts;

  const groups = new Map<
    string,
    { sample: RecCandidate; count: number; totalScore: number; bestSeed: string; bestScore: number }
  >();

  for (const c of candidates) {
    const key = `${c.source}:${c.id}`;
    if (excludedIds.has(key)) continue;
    if (excludedTitles.has(normalize(c.title))) continue;

    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        sample: c,
        count: 1,
        totalScore: c.score,
        bestSeed: c.seedTitle,
        bestScore: c.score,
      });
    } else {
      g.count += 1;
      g.totalScore += c.score;
      // The strongest-scoring seed becomes the "because you have …" attribution.
      if (c.score > g.bestScore) {
        g.bestScore = c.score;
        g.bestSeed = c.seedTitle;
      }
    }
  }

  return [...groups.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.totalScore - a.totalScore ||
        a.sample.title.localeCompare(b.sample.title),
    )
    .slice(0, limit)
    .map((g) => ({
      source: g.sample.source,
      id: g.sample.id,
      title: g.sample.title,
      coverUrl: g.sample.coverUrl,
      count: g.count,
      becauseTitle: g.bestSeed,
    }));
}

// A library row's identity in `source`: the primary external_id when that source
// IS the row's source of record, else the cross-reference column (migration 0008).
// Returns null when the row has no id for that source (→ can't seed from it).
// Mirrors src/client/lib/crossRef.ts, server-side and minimal.
export interface SeedRefRow {
  external_source: string | null;
  external_id: string | null;
  anilist_id: string | null;
  tmdb_id: string | null;
  igdb_id: string | null;
  bangumi_id: string | null;
}

export function sourceIdOf(row: SeedRefRow, source: string): string | null {
  if (row.external_source === source) return row.external_id;
  switch (source) {
    case "anilist":
      return row.anilist_id;
    case "tmdb":
      return row.tmdb_id;
    case "igdb":
      return row.igdb_id;
    case "bangumi":
      return row.bangumi_id;
    default:
      return null;
  }
}
