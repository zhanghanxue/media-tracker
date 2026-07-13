// Feature B (Recommendations) — client side. Two paths, mirroring the add flow's
// source split:
//   • animation → computed IN THE BROWSER (AniList blocks Worker egress): seed
//     from the library's anime, fan out AniList recommendations, aggregate here.
//   • movie / drama / variety / game → GET /api/recommendations (the Worker calls
//     TMDB / IGDB, which are key-bearing).
// Both return the same Recommendation shape so the UI is source-agnostic.

import {
  getAniListRecommendations,
  type AniListMedia,
} from "../../worker/sources/anilist";
import {
  aggregateRecommendations,
  type RankedRecommendation,
} from "../../worker/api/recommend";
import { normalizeTitle } from "../../worker/sources/bangumi-mapper";
import { toSimplified } from "./toSimplified";
import type { MediaListResponse, MediaRow } from "./types";

export type RecommendType = "animation" | "movie" | "drama" | "variety" | "game";

// What the UI renders + can add. `addRef` carries exactly what the add flow needs
// per source (AniList POSTs the media object; the others POST id + kind).
export interface Recommendation {
  source: "anilist" | "tmdb" | "igdb";
  /** Stable React key + dedup id (source-native; TMDB kind-prefixed). */
  id: string;
  title: string;
  /** Chinese display title when the source ships one (IGDB alt-name, Simplified
   *  by fetch time; TMDB titles are already zh so they stay in `title`). AniList
   *  has none — the panel backfills those from Bangumi as they resolve. */
  titleChinese: string | null;
  /** Native (Japanese) title — the zh-UI fallback while no Chinese title is
   *  known, mirroring displayTitle's chinese ?? native ?? english chain. */
  titleNative: string | null;
  coverUrl: string | null;
  /** "because you have …" — the seed that surfaced it. */
  becauseTitle: string;
  /** The payload to hand the existing add flow (see useRecommendations add). */
  addRef:
    | { source: "anilist"; media: AniListMedia }
    | { source: "tmdb"; id: number; kind: "movie" | "tv" }
    | { source: "igdb"; id: number };
}

// Seeds capped to bound AniList calls; the ranked pool is several UI batches
// (the panel shows 15 at a time and rotates without recomputing).
const SEED_LIMIT = 20;
const POOL_LIMIT = 60;

// How many top library items (completed first, then in_progress, newest within)
// to seed anime recs from. Mirrors the Worker's selectRecommendationSeeds.
function pickAnimeSeeds(items: MediaRow[]): MediaRow[] {
  const anime = items.filter(
    (r) =>
      r.type === "animation" &&
      (r.status === "completed" || r.status === "in_progress") &&
      // Needs an AniList id to seed from (primary or cross-reference).
      (r.external_source === "anilist" ? r.external_id : r.anilist_id),
  );
  const rank = (r: MediaRow) =>
    (r.status === "completed" ? 0 : 1) * 1e15 -
    new Date(r.date_updated).getTime();
  return anime.sort((a, b) => rank(a) - rank(b)).slice(0, SEED_LIMIT);
}

function anilistIdOf(row: MediaRow): number | null {
  const raw = row.external_source === "anilist" ? row.external_id : row.anilist_id;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function seedTitle(row: MediaRow): string {
  return (
    row.title_chinese ??
    row.title_english ??
    row.title_romaji ??
    row.title_native ??
    `#${row.id}`
  );
}

// Browser-side anime recommendations. Seeds from the library, fans out AniList
// recs per seed, then reuses the SAME pure aggregator the Worker uses, excluding
// everything already owned (by AniList id and by normalized title).
async function recommendAnime(): Promise<Recommendation[]> {
  const res = await fetch("/api/media?limit=5000");
  if (!res.ok) throw new Error(`Failed to load library (HTTP ${res.status})`);
  const { items } = (await res.json()) as MediaListResponse;

  const seeds = pickAnimeSeeds(items);
  if (seeds.length === 0) return [];

  // Keep the picked AniList media around so the Add button can POST the full
  // object (the AniList add flow maps it server-side, like search→add).
  const mediaById = new Map<string, AniListMedia>();
  const candidates = [];
  for (const seed of seeds) {
    const id = anilistIdOf(seed);
    if (id === null) continue;
    let recs;
    try {
      recs = await getAniListRecommendations(id);
    } catch {
      continue; // one seed's AniList hiccup shouldn't sink the whole panel
    }
    for (const rec of recs) {
      const key = String(rec.media.id);
      mediaById.set(key, rec.media);
      candidates.push({
        source: "anilist",
        id: key,
        title:
          rec.media.title.english ??
          rec.media.title.romaji ??
          rec.media.title.native ??
          `#${rec.media.id}`,
        coverUrl: rec.media.coverImage.extraLarge,
        score: rec.rating,
        seedTitle: seedTitle(seed),
      });
    }
  }

  // Exclude everything already in the library: by AniList id, and by title.
  const excludedIds = new Set<string>();
  const excludedTitles = new Set<string>();
  for (const row of items) {
    const aid = row.external_source === "anilist" ? row.external_id : row.anilist_id;
    if (aid) excludedIds.add(`anilist:${aid}`);
    for (const t of [row.title_native, row.title_romaji, row.title_english, row.title_chinese]) {
      if (t) excludedTitles.add(normalizeTitle(t));
    }
  }

  const ranked = aggregateRecommendations(candidates, {
    excludedIds,
    excludedTitles,
    normalize: normalizeTitle,
    limit: POOL_LIMIT,
  });

  return ranked.map((r) => toRecommendation(r, mediaById));
}

// Map a ranked AniList result back to a Recommendation, attaching the saved media
// object for the add flow. (Worker-sourced types use toWorkerRecommendation.)
function toRecommendation(
  r: RankedRecommendation,
  mediaById: Map<string, AniListMedia>,
): Recommendation {
  const media = mediaById.get(r.id)!;
  return {
    source: "anilist",
    id: r.id,
    title: r.title,
    titleChinese: null, // AniList ships none; the panel backfills from Bangumi.
    titleNative: media.title.native,
    coverUrl: r.coverUrl,
    becauseTitle: r.becauseTitle,
    addRef: { source: "anilist", media },
  };
}

// Worker-sourced (TMDB / IGDB) recommendations. The Worker already aggregated +
// excluded; we just map ids to add payloads.
function toWorkerRecommendation(r: RankedRecommendation): Recommendation {
  if (r.source === "tmdb") {
    // id is "movie:603" | "tv:1399" | "tv:1399:s2"; recs are whole shows/movies.
    // TMDB titles arrive zh-CN-localized already, so `title` needs no variant.
    const [kind, num] = r.id.split(":");
    return {
      source: "tmdb",
      id: r.id,
      title: r.title,
      titleChinese: null,
      titleNative: null,
      coverUrl: r.coverUrl,
      becauseTitle: r.becauseTitle,
      addRef: { source: "tmdb", id: Number(num), kind: kind === "movie" ? "movie" : "tv" },
    };
  }
  return {
    source: "igdb",
    id: r.id,
    title: r.title,
    titleChinese: r.titleChinese ?? null,
    titleNative: null,
    coverUrl: r.coverUrl,
    becauseTitle: r.becauseTitle,
    addRef: { source: "igdb", id: Number(r.id) },
  };
}

export async function fetchRecommendations(
  type: RecommendType,
): Promise<Recommendation[]> {
  if (type === "animation") return recommendAnime();

  const res = await fetch(`/api/recommendations?type=${encodeURIComponent(type)}`);
  if (!res.ok) throw new Error(`Failed to load recommendations (HTTP ${res.status})`);
  const { recommendations } = (await res.json()) as {
    recommendations: RankedRecommendation[];
  };
  // IGDB alt-name titles can be Traditional; normalize to Simplified like every
  // other title we display (OpenCC is browser-only, hence here not the Worker).
  return Promise.all(
    recommendations.map(toWorkerRecommendation).map(async (rec) =>
      rec.titleChinese
        ? { ...rec, titleChinese: await toSimplified(rec.titleChinese) }
        : rec,
    ),
  );
}
