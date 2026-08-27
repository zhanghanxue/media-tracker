// "What else belongs in this collection?" — the gap scan behind the collection
// drill-down's Missing panel.
//
// The scan needs the collection's SOURCE membership. Where that comes from
// differs by source, and only TMDB puts it in the collection id:
//   • "tmdb:collection:<id>" — a movie franchise (Rocky, Alien). TMDB's
//     /collection/{id} returns `parts`, every film in the franchise.
//   • "tmdb:tv:<id>"         — one show's seasons. The show detail's `seasons`
//     is the full run.
//   • games  — the mapper stamps "igdb:collection:<id>", but only for adds made
//     since that shipped; most of the library sits in hand-made or backfilled
//     groups. So the series are resolved from the MEMBERS' IGDB ids (one batched
//     request), with a stamped id unioned in when there is one.
//   • anime  — AniList has no collection object at all, and the client's
//     auto-grouping creates collections with generated ids carrying no source
//     identity. The "series" is the SEQUEL/PREQUEL chain, walked from the
//     members' AniList ids.
// A hand-made collection of unlinked items has no source membership to compare
// against, so it has no scan — scanSource returns null and the UI hides the
// entry point.
//
// Ownership is checked TWICE, cheaply, and never by fetching the whole library:
//   1. against the collection's own members (already loaded by the drill-down);
//   2. against the source's /existing probe for the remaining candidates — this
//      catches an entry that IS tracked but sits in a different collection,
//      which would otherwise be offered as missing and then bounce off the add
//      route's 409.

import {
  fetchTmdbCollection,
  fetchTmdbExisting,
  fetchTmdbSeasons,
} from "./tmdbSearch";
import {
  fetchIgdbExisting,
  fetchIgdbSeriesGames,
  fetchIgdbSeriesOf,
  guessPlatformBucket,
  igdbCover,
  igdbYear,
} from "./igdbSearch";
import { fetchAniListExisting } from "./api";
import { anilistIdOf, igdbIdOf } from "./crossRef";
import { tmdbPosterUrl } from "../../worker/sources/tmdb";
import {
  getAniListDetail,
  getAniListRelations,
  type AniListMedia,
} from "../../worker/sources/anilist";
import type { MediaRow } from "./types";

/** Which source membership a collection can be expanded against. */
export type GapSource =
  | { kind: "movie_franchise"; tmdbId: number }
  | { kind: "tv_seasons"; tmdbId: number }
  | { kind: "igdb_series"; gameIds: number[]; seriesIds: number[] }
  | { kind: "anilist_chain"; anilistIds: number[] };

/** One thing the source has that the library doesn't. */
export interface CollectionGap {
  /** The external_id the add would create — also the React key. */
  externalId: string;
  kind: "movie" | "season" | "game" | "anime";
  /**
   * The source's own name for it. Used as-is for a film / game / anime; for a
   * season the UI prefers a localized "Season N" built from `seasonNumber`,
   * because the seasons proxy asks TMDB in zh-CN for everyone (the Add modal's
   * picker depends on that) and a Chinese season name in an English UI reads
   * wrong.
   */
  title: string;
  /** Present for kind === "season" — lets the UI label it in the UI language. */
  seasonNumber?: number;
  /** Release year. Null when unknown. */
  subtitle: string | null;
  coverUrl: string | null;
  /** What POST /api/media needs to add it. */
  addRef:
    | { source: "tmdb"; mediaType: "movie"; id: number }
    | { source: "tmdb"; mediaType: "tv"; id: number; seasonNumber: number }
    | { source: "igdb"; id: number; platform: string | null }
    | { source: "anilist"; media: AniListMedia };
}

const MOVIE_FRANCHISE = /^tmdb:collection:([1-9][0-9]*)$/;
const TV_SEASONS = /^tmdb:tv:([1-9][0-9]*)$/;
const IGDB_SERIES = /^igdb:collection:([1-9][0-9]*)$/;

// Pacing for the browser-driven walks. IGDB allows 4 req/s; AniList ~90/min.
const IGDB_PER_MS = 300;
const ANILIST_PER_MS = 350;
// A collection is one franchise, not a genre. These caps stop a mis-grouped
// collection (or an AniList chain that loops through a long-running franchise)
// from turning one click into a hundred upstream calls.
const MAX_IGDB_SERIES = 6;
const MAX_ANILIST_WALK = 24;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Called after each upstream lookup with the number completed so far. The
 * AniList walk in particular can take ten-plus seconds — it discovers the chain
 * one node at a time, paced under the rate limit — so the panel needs something
 * to show besides a frozen "checking…".
 */
export type GapProgress = (done: number) => void;

/** Counts calls and reports them, so each candidate builder stays readable. */
function progressCounter(onProgress?: GapProgress) {
  let done = 0;
  return () => onProgress?.(++done);
}

// Relations that mean "the same series, another entry", and the formats that
// count as a season rather than a recap film or OVA. Same rules the AniList
// auto-grouping uses, so the scan proposes what the grouper would have linked.
const CHAIN_RELATIONS = new Set(["SEQUEL", "PREQUEL"]);
const SEASON_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);

/** Positive integers parsed out of a row's cross-reference id for `source`. */
function sourceIds(rows: MediaRow[], read: (r: MediaRow) => string | null): number[] {
  const out = new Set<number>();
  for (const row of rows) {
    const n = Number(read(row));
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out];
}

/**
 * The source membership this collection can be expanded against, or null when
 * nothing in it is linked to a source that has a notion of "the rest of the
 * series". Pure — `members` are the rows the drill-down already loaded.
 *
 * TMDB's collection ids win because they name the franchise exactly. Otherwise
 * the members decide, games before anime (a game collection rarely carries
 * AniList ids, but an anime collection can carry neither).
 */
export function scanSource(
  collectionId: string | null,
  members: MediaRow[] = [],
): GapSource | null {
  const franchise = collectionId && MOVIE_FRANCHISE.exec(collectionId);
  if (franchise) {
    return { kind: "movie_franchise", tmdbId: Number(franchise[1]) };
  }
  const seasons = collectionId && TV_SEASONS.exec(collectionId);
  if (seasons) return { kind: "tv_seasons", tmdbId: Number(seasons[1]) };

  const gameIds = sourceIds(members, igdbIdOf);
  const stamped = collectionId && IGDB_SERIES.exec(collectionId);
  if (gameIds.length > 0 || stamped) {
    return {
      kind: "igdb_series",
      gameIds,
      seriesIds: stamped ? [Number(stamped[1])] : [],
    };
  }

  const anilistIds = sourceIds(members, anilistIdOf);
  if (anilistIds.length > 0) return { kind: "anilist_chain", anilistIds };

  return null;
}

/**
 * The external ids a set of library rows accounts for, for `source`. Only rows
 * whose source of record matches carry one; a row linked to that source only by
 * cross-reference is caught by the server probe instead. Pure.
 */
export function trackedExternalIds(
  rows: MediaRow[],
  source: "tmdb" | "igdb" | "anilist" = "tmdb",
): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    if (row.external_source === source && row.external_id) {
      out.add(row.external_id);
    }
  }
  return out;
}

/** Year from a TMDB date string ("1976-11-21" → "1976"), or null. */
function yearOf(date: string | null | undefined): string | null {
  return date ? date.slice(0, 4) : null;
}

/**
 * Drop candidates the library already has. Split from the fetching so the
 * diff itself is a pure, testable function. Pure.
 */
export function excludeTracked(
  candidates: CollectionGap[],
  tracked: Set<string>,
): CollectionGap[] {
  return candidates.filter((c) => !tracked.has(c.externalId));
}

/** Drop repeats — two series, or two chain seeds, can reach the same entry. */
export function dedupeGaps(gaps: CollectionGap[]): CollectionGap[] {
  const seen = new Set<string>();
  return gaps.filter((g) => {
    if (seen.has(g.externalId)) return false;
    seen.add(g.externalId);
    return true;
  });
}

/** Every film in a TMDB franchise, as gap candidates (nothing excluded yet). */
async function franchiseCandidates(tmdbId: number): Promise<CollectionGap[]> {
  const { parts } = await fetchTmdbCollection(tmdbId);
  return parts.map((p) => ({
    externalId: `movie:${p.id}`,
    kind: "movie" as const,
    title: p.title ?? `#${p.id}`,
    subtitle: yearOf(p.release_date),
    coverUrl: tmdbPosterUrl(p.poster_path),
    addRef: { source: "tmdb" as const, mediaType: "movie" as const, id: p.id },
  }));
}

/** Every season of a TMDB show, as gap candidates (nothing excluded yet). */
async function seasonCandidates(tmdbId: number): Promise<CollectionGap[]> {
  const seasons = await fetchTmdbSeasons(tmdbId);
  return seasons.map((s) => ({
    externalId: `tv:${tmdbId}:s${s.season_number}`,
    kind: "season" as const,
    title: s.name ?? `Season ${s.season_number}`,
    seasonNumber: s.season_number,
    subtitle: yearOf(s.air_date),
    coverUrl: tmdbPosterUrl(s.poster_path),
    addRef: {
      source: "tmdb" as const,
      mediaType: "tv" as const,
      id: tmdbId,
      seasonNumber: s.season_number,
    },
  }));
}

/**
 * Every game in the series the members belong to. The series are resolved from
 * the members rather than the collection id — see the header note.
 */
async function igdbCandidates(
  source: Extract<GapSource, { kind: "igdb_series" }>,
  tick: () => void,
): Promise<CollectionGap[]> {
  const resolved = await fetchIgdbSeriesOf(source.gameIds);
  tick();
  const seriesIds = [
    ...new Set([...source.seriesIds, ...resolved.map((s) => s.id)]),
  ].slice(0, MAX_IGDB_SERIES);

  const out: CollectionGap[] = [];
  for (const [i, seriesId] of seriesIds.entries()) {
    if (i > 0) await sleep(IGDB_PER_MS);
    const games = await fetchIgdbSeriesGames(seriesId);
    tick();
    for (const g of games) {
      const year = igdbYear(g);
      out.push({
        externalId: String(g.id),
        kind: "game",
        title: g.name ?? `#${g.id}`,
        subtitle: year === null ? null : String(year),
        coverUrl: igdbCover(g),
        addRef: {
          source: "igdb",
          id: g.id,
          platform: guessPlatformBucket(g),
        },
      });
    }
  }
  return dedupeGaps(out);
}

/**
 * The AniList SEQUEL/PREQUEL chain reachable from the members, minus the
 * members themselves. Walks transitively (a season 4 is only reachable via
 * season 3) but bounded by MAX_ANILIST_WALK.
 *
 * Runs browser-direct like every other AniList call — the Worker's egress IP is
 * blocked by AniList.
 */
async function anilistCandidates(
  seedIds: number[],
  tick: () => void,
): Promise<CollectionGap[]> {
  const seen = new Set<number>(seedIds);
  const queue = [...seedIds];
  const discovered: number[] = [];

  while (queue.length > 0 && discovered.length < MAX_ANILIST_WALK) {
    const id = queue.shift()!;
    let edges;
    try {
      edges = await getAniListRelations(id);
    } catch {
      continue; // one bad node shouldn't sink the whole chain
    }
    tick();
    await sleep(ANILIST_PER_MS);
    for (const e of edges) {
      if (!CHAIN_RELATIONS.has(e.relationType)) continue;
      if (e.node.format && !SEASON_FORMATS.has(e.node.format)) continue;
      if (seen.has(e.node.id)) continue;
      seen.add(e.node.id);
      discovered.push(e.node.id);
      // Keep walking through it: the chain is a line, not a star.
      queue.push(e.node.id);
    }
  }
  if (discovered.length === 0) return [];

  // Drop what's already tracked BEFORE paying for detail — each detail is its
  // own AniList round trip, and most of a chain is usually already in the
  // library. (findCollectionGaps re-checks after this; that pass is free.)
  const owned = await fetchAniListExisting(discovered.map(String));
  const wanted = discovered.filter((id) => !owned.has(String(id)));

  const out: CollectionGap[] = [];
  for (const id of wanted) {
    let media: AniListMedia | null = null;
    try {
      media = await getAniListDetail(id, "ANIME");
    } catch {
      media = null;
    }
    tick();
    await sleep(ANILIST_PER_MS);
    if (!media) continue;
    out.push({
      externalId: String(id),
      kind: "anime",
      title:
        media.title.english ??
        media.title.romaji ??
        media.title.native ??
        `#${id}`,
      subtitle: media.startDate?.year ? String(media.startDate.year) : null,
      coverUrl: media.coverImage?.extraLarge ?? null,
      addRef: { source: "anilist", media },
    });
  }
  return out;
}

/** The source-side "am I already tracking these?" probe for a scan source. */
function existingProbe(
  kind: GapSource["kind"],
): (ids: string[]) => Promise<Set<string>> {
  if (kind === "igdb_series") return fetchIgdbExisting;
  if (kind === "anilist_chain") return fetchAniListExisting;
  return fetchTmdbExisting;
}

/** Which library source a scan's candidates are keyed against. */
function trackedSource(kind: GapSource["kind"]): "tmdb" | "igdb" | "anilist" {
  if (kind === "igdb_series") return "igdb";
  if (kind === "anilist_chain") return "anilist";
  return "tmdb";
}

/**
 * Everything the source has for `collectionId` that the library doesn't.
 *
 * `members` are the collection's own items (the drill-down already has them):
 * they both identify the source for game/anime collections and filter the
 * obvious matches without a round-trip. Whatever survives is then probed
 * against the library so an item filed elsewhere isn't offered.
 *
 * Returns [] for a collection with no scannable source.
 */
export async function findCollectionGaps(
  collectionId: string | null,
  members: MediaRow[],
  onProgress?: GapProgress,
): Promise<CollectionGap[]> {
  const source = scanSource(collectionId, members);
  if (source === null) return [];
  const tick = progressCounter(onProgress);

  let candidates: CollectionGap[];
  switch (source.kind) {
    case "movie_franchise":
      candidates = await franchiseCandidates(source.tmdbId);
      tick();
      break;
    case "tv_seasons":
      candidates = await seasonCandidates(source.tmdbId);
      tick();
      break;
    case "igdb_series":
      candidates = await igdbCandidates(source, tick);
      break;
    case "anilist_chain":
      candidates = await anilistCandidates(source.anilistIds, tick);
      break;
  }

  const local = excludeTracked(
    candidates,
    trackedExternalIds(members, trackedSource(source.kind)),
  );
  if (local.length === 0) return [];

  // Second pass: the remaining candidates might still be tracked under another
  // collection. One bounded lookup, not a library fetch.
  const elsewhere = await existingProbe(source.kind)(
    local.map((c) => c.externalId),
  );
  return excludeTracked(local, elsewhere);
}
