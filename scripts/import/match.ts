// Phase 12 matcher. Given a ParsedEntry, search the right source(s) and rank
// candidate matches into a confidence bucket (auto / review / none) for the
// review queue. PURE scoring + source-selection; the network search is INJECTED
// (the runner provides the real, rate-limited, credentialed implementations),
// so this is unit-tested without any API calls — and nothing here writes.
//
// Source strategy per type (CJK-first where the list's titles are Chinese):
//   animation / manga / light_novel → Bangumi (handles CJK + romaji), then AniList
//   drama / movie                   → TMDB, then Bangumi (type 6)
//   variety                         → Bangumi (type 6, 综艺), then TMDB
//   game                            → IGDB (now Chinese-capable), then Bangumi (4)
// A Bangumi candidate is later added via the existing add-by-Chinese flow (which
// resolves to the canonical AniList entry where one exists); the others add direct.

import { normalizeTitle } from "../../src/worker/sources/bangumi-mapper";
import type { MediaType } from "../../src/worker/db/schema";
import type { ParsedEntry } from "./parse";

export type Source = "anilist" | "bangumi" | "tmdb" | "igdb";

// Source + its search sub-type (AniList ANIME|MANGA, Bangumi 1/2/4/6, TMDB
// movie|tv, IGDB none).
export interface SourceQuery {
  source: Source;
  subtype: string | number | null;
}

// A search hit, normalized into a source-agnostic shape. `titles` are all the
// hit's titles (native / romaji / english / chinese / aliases) for scoring;
// `payload` is the original source object the runner needs to add it.
export interface RawCandidate {
  source: Source;
  id: string;
  titles: string[];
  year?: number | null;
  payload: unknown;
}

export interface Candidate extends RawCandidate {
  score: number; // 0..1
}

export type MatchBucket = "auto" | "review" | "none";

export interface MatchResult {
  entry: ParsedEntry;
  bucket: MatchBucket;
  candidates: Candidate[]; // ranked, best first
}

export interface MatchOptions {
  /** Fold a title before comparison (e.g. Traditional→Simplified). Default identity. */
  simplify?: (s: string) => string;
  /** Top score to auto-accept an unambiguous singleton. Default 1 (exact). */
  autoThreshold?: number;
  /** Min top score to send to the review queue. Default 0.5. */
  reviewThreshold?: number;
  /** Max candidates kept per entry. Default 5. */
  topN?: number;
}

// The injected search: resolve a (source, subtype, query) to candidate hits.
export type SearchFn = (
  source: Source,
  subtype: string | number | null,
  query: string,
) => Promise<RawCandidate[]>;

// Which sources to try, in priority order, for a given media type.
export function sourcesFor(type: MediaType): SourceQuery[] {
  switch (type) {
    case "animation":
      return [
        { source: "bangumi", subtype: 2 },
        { source: "anilist", subtype: "ANIME" },
      ];
    case "manga":
    case "light_novel":
      return [
        { source: "bangumi", subtype: 1 },
        { source: "anilist", subtype: "MANGA" },
      ];
    case "drama":
      return [
        { source: "tmdb", subtype: "tv" },
        { source: "bangumi", subtype: 6 },
      ];
    case "movie":
      return [
        { source: "tmdb", subtype: "movie" },
        { source: "bangumi", subtype: 6 },
      ];
    case "variety":
      return [
        { source: "bangumi", subtype: 6 },
        { source: "tmdb", subtype: "tv" },
      ];
    case "game":
      return [
        { source: "igdb", subtype: null },
        { source: "bangumi", subtype: 4 },
      ];
  }
}

function norm(s: string, simplify: (s: string) => string): string {
  return normalizeTitle(simplify(s));
}

// Best title-overlap score between an entry's titles and a candidate's: exact
// normalized match → 1; one a prefix of the other → 0.7; substring → 0.55; else 0.
export function scoreMatch(
  entryTitles: string[],
  candidateTitles: string[],
  simplify: (s: string) => string = (s) => s,
): number {
  const ek = [...new Set(entryTitles.map((t) => norm(t, simplify)))].filter(Boolean);
  const ck = [...new Set(candidateTitles.map((t) => norm(t, simplify)))].filter(Boolean);
  if (ek.length === 0 || ck.length === 0) return 0;

  let best = 0;
  for (const e of ek) {
    for (const c of ck) {
      if (e === c) return 1;
      if (
        e.length >= 2 &&
        c.length >= 2 &&
        (c.startsWith(e) || e.startsWith(c))
      ) {
        best = Math.max(best, 0.7);
      } else if (e.length >= 3 && c.includes(e)) {
        best = Math.max(best, 0.55);
      }
    }
  }
  return best;
}

// Bucket an entry from its ranked candidates. Bracketed (series) entries always
// go to review — the season/part→source mapping needs a human. A non-series
// entry auto-accepts only on a single unambiguous exact hit.
export function bucketFor(
  entry: ParsedEntry,
  candidates: Candidate[],
  opts: MatchOptions = {},
): MatchBucket {
  if (candidates.length === 0) return "none";
  const top = candidates[0]!.score;
  const auto = opts.autoThreshold ?? 1;
  const review = opts.reviewThreshold ?? 0.5;

  if (top <= 0) return "none";
  if (entry.parts.length > 0) return "review"; // series → always confirm by hand

  if (top >= auto) {
    const second = candidates[1]?.score ?? 0;
    return second >= auto ? "review" : "auto"; // tie at the top → review
  }
  return top >= review ? "review" : "review";
}

export async function matchEntry(
  entry: ParsedEntry,
  search: SearchFn,
  opts: MatchOptions = {},
): Promise<MatchResult> {
  const simplify = opts.simplify ?? ((s) => s);
  const auto = opts.autoThreshold ?? 1;
  const titles = [entry.title, ...entry.altTitles].filter(Boolean);

  const raw: RawCandidate[] = [];
  for (const { source, subtype } of sourcesFor(entry.type)) {
    for (const q of titles) {
      raw.push(...(await search(source, subtype, q)));
    }
    // Stop once a source has yielded an exact hit — no need to query fallbacks.
    if (raw.some((c) => scoreMatch(titles, c.titles, simplify) >= auto)) break;
  }

  // Score + dedup by source:id (keep the best score per id).
  const byId = new Map<string, Candidate>();
  for (const c of raw) {
    const key = `${c.source}:${c.id}`;
    const score = scoreMatch(titles, c.titles, simplify);
    const prev = byId.get(key);
    if (!prev || score > prev.score) byId.set(key, { ...c, score });
  }

  const candidates = [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.topN ?? 5);

  return { entry, bucket: bucketFor(entry, candidates, opts), candidates };
}
