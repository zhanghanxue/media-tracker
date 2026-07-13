// Feature B (Recommendations) — Worker side. GET /api/recommendations?type=…
// Branches per type → its source, exactly like the add flow (no shared
// abstraction): movie/drama/variety → TMDB /{movie|tv}/{id}/recommendations;
// game → IGDB similar_games. ANIME is NOT served here — AniList blocks Worker
// egress, so the browser computes anime recs itself (mirrors the add flow).
//
// Shape: take a bounded seed set (selectRecommendationSeeds), fan out one recs
// call per seed, flatten into RecCandidate[], then aggregate + library-exclude +
// rank (pure, in api/recommend.ts). Bounded seeds × one call each keeps it well
// under the Worker CPU budget; the external-call count is the real cost, capped
// by the seed limit. No caching/persistence in v2.0 (per the PRD build-order note).

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import {
  selectLibraryIdentities,
  selectRecommendationSeeds,
} from "../db/media-repository";
import {
  aggregateRecommendations,
  sourceIdOf,
  type RankedRecommendation,
  type RecCandidate,
} from "../api/recommend";
import { normalizeTitle } from "../sources/bangumi-mapper";
import {
  getTmdbRecommendations,
  tmdbPosterUrl,
  type TmdbKind,
  type TmdbSearchResultRaw,
} from "../sources/tmdb";
import { getIgdbSimilarGames, igdbCoverUrl } from "../sources/igdb";
import { pickHanAlias } from "../sources/igdb-alias";
import type { MediaRow } from "../db/schema";

export const recommendRoutes = new Hono<{
  Bindings: AppEnv;
  Variables: AuthVariables;
}>();

// How many library items to seed from, and how deep a ranked pool to return.
// Seeds are capped so the external-call count stays bounded regardless of
// library size. The pool is several UI batches — the client shows 15 at a time
// and its "show another batch" button rotates through the rest without a refetch.
const SEED_LIMIT = 20;
const POOL_LIMIT = 60;

// The worker-served types and the source each maps to. `animation` is absent on
// purpose — it's browser-side (AniList). movie/drama/variety → TMDB (drama/variety
// are tv); game → IGDB.
const TYPE_SOURCE: Record<string, "tmdb" | "igdb"> = {
  movie: "tmdb",
  drama: "tmdb",
  variety: "tmdb",
  game: "igdb",
};

// A library row's display title for the "because you have …" attribution.
function seedTitle(row: MediaRow): string {
  return (
    row.title_chinese ??
    row.title_english ??
    row.title_romaji ??
    row.title_native ??
    `#${row.id}`
  );
}

// TMDB recommendation row → candidate. id is kind-prefixed ("movie:603") to match
// how the library stores TMDB external_id, so exclusion compares like-for-like.
function tmdbCandidate(
  r: TmdbSearchResultRaw,
  kind: TmdbKind,
  seed: string,
): RecCandidate {
  return {
    source: "tmdb",
    id: `${kind}:${r.id}`,
    title: r.title ?? r.name ?? r.original_title ?? r.original_name ?? `#${r.id}`,
    coverUrl: tmdbPosterUrl(r.poster_path),
    score: r.vote_average ?? 0,
    seedTitle: seed,
  };
}

recommendRoutes.get("/", async (c) => {
  const type = c.req.query("type") ?? "";
  const source = TYPE_SOURCE[type];
  if (!source) {
    // animation is handled in the browser; anything else is unsupported here.
    return c.json(
      { error: "type must be one of: movie, drama, variety, game" },
      400,
    );
  }

  if (source === "tmdb" && !c.env.TMDB_API_KEY) {
    return c.json({ error: "TMDB integration is not configured" }, 503);
  }
  if (source === "igdb" && (!c.env.TWITCH_CLIENT_ID || !c.env.TWITCH_CLIENT_SECRET)) {
    return c.json({ error: "IGDB integration is not configured" }, 503);
  }

  const seeds = await selectRecommendationSeeds(c.env.DB, type, SEED_LIMIT);
  if (seeds.length === 0) {
    return c.json({ recommendations: [] satisfies RankedRecommendation[] });
  }

  // tv-family types (drama/variety) recommend off the tv endpoint; movie off movie.
  const tmdbKind: TmdbKind = type === "movie" ? "movie" : "tv";

  const candidates: RecCandidate[] = [];
  try {
    for (const seed of seeds) {
      if (source === "tmdb") {
        const id = sourceIdOf(seed, "tmdb"); // "movie:603" | "tv:1399" | "tv:1399:s2"
        if (!id) continue;
        const numeric = Number(id.split(":")[1]);
        if (!Number.isFinite(numeric)) continue;
        const recs = await getTmdbRecommendations(numeric, tmdbKind, {
          apiKey: c.env.TMDB_API_KEY!,
        });
        for (const r of recs) candidates.push(tmdbCandidate(r, tmdbKind, seedTitle(seed)));
      } else {
        const id = sourceIdOf(seed, "igdb");
        if (!id) continue;
        const numeric = Number(id);
        if (!Number.isFinite(numeric)) continue;
        const similar = await getIgdbSimilarGames(numeric, {
          clientId: c.env.TWITCH_CLIENT_ID!,
          clientSecret: c.env.TWITCH_CLIENT_SECRET!,
        });
        for (const g of similar) {
          candidates.push({
            source: "igdb",
            id: String(g.id),
            title: g.name ?? `#${g.id}`,
            titleChinese: pickHanAlias(
              (g.alternative_names ?? []).map((a) => a.name),
            ),
            coverUrl: igdbCoverUrl(g.cover?.image_id),
            score: g.rating ?? 0,
            seedTitle: seedTitle(seed),
          });
        }
      }
    }
  } catch {
    // An upstream source failure mid-fan-out: surface as 502 so the client shows
    // "couldn't load" rather than a misleadingly short list.
    return c.json({ error: "recommendation source request failed" }, 502);
  }

  const { keys, titles } = await selectLibraryIdentities(c.env.DB);
  const excludedTitles = new Set(
    titles.filter((t): t is string => !!t).map(normalizeTitle),
  );
  const recommendations = aggregateRecommendations(candidates, {
    excludedIds: new Set(keys),
    excludedTitles,
    normalize: normalizeTitle,
    limit: POOL_LIMIT,
  });

  return c.json({ recommendations });
});
