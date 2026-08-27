// TMDB Worker routes. UNLIKE the AniList route (which only does a D1 lookup
// because the browser calls AniList directly), the Worker proxies TMDB search
// itself — TMDB is key-bearing and the key must never reach the browser. The
// add flow's detail fetch lives in POST /api/media for the same reason.

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import {
  getTmdbCollection,
  getTmdbDetail,
  searchTmdb,
  type TmdbKind,
} from "../sources/tmdb";
import { findExistingExternalIds } from "../db/media-repository";
import { stripCollectionSuffix } from "../sources/collection-name";

export const tmdbRoutes = new Hono<{
  Bindings: AppEnv;
  Variables: AuthVariables;
}>();

// GET /api/tmdb/search?q=...&kind=movie|tv → { results: [...] }
tmdbRoutes.get("/search", async (c) => {
  const apiKey = c.env.TMDB_API_KEY;
  if (!apiKey) {
    return c.json({ error: "TMDB integration is not configured" }, 503);
  }

  const q = (c.req.query("q") ?? "").trim();
  if (q === "") {
    return c.json({ results: [] });
  }

  const kind = c.req.query("kind");
  if (kind !== "movie" && kind !== "tv") {
    return c.json({ error: "kind must be 'movie' or 'tv'" }, 400);
  }

  try {
    const results = await searchTmdb(q, kind as TmdbKind, { apiKey });
    return c.json({ results });
  } catch {
    // Upstream TMDB failure (rate limit exhausted, 5xx, network). Surface as 502
    // so the client shows "search failed" rather than a misleading empty result.
    return c.json({ error: "TMDB search failed" }, 502);
  }
});

// GET /api/tmdb/tv/:id/seasons → { seasons: [...] }. The real seasons (>= 1,
// excluding the "specials" bucket), localized to zh-CN for the picker. Used by
// the Add modal to let the user add specific seasons of a multi-season show.
tmdbRoutes.get("/tv/:id/seasons", async (c) => {
  const apiKey = c.env.TMDB_API_KEY;
  if (!apiKey) {
    return c.json({ error: "TMDB integration is not configured" }, 503);
  }
  const idParam = c.req.param("id");
  if (!/^[1-9][0-9]*$/.test(idParam)) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }

  let detail;
  try {
    detail = await getTmdbDetail(Number(idParam), "tv", { apiKey, language: "zh-CN" });
  } catch {
    return c.json({ error: "TMDB request failed" }, 502);
  }
  if (detail === null) {
    return c.json({ error: "show not found on TMDB" }, 404);
  }

  const seasons = (detail.seasons ?? [])
    .filter((s) => s.season_number >= 1)
    .map((s) => ({
      season_number: s.season_number,
      name: s.name ?? null,
      episode_count: s.episode_count ?? null,
      air_date: s.air_date ?? null,
      poster_path: s.poster_path ?? null,
    }));
  return c.json({ seasons });
});

// GET /api/tmdb/collection/:id → { name, parts: [...] }. Every film TMDB files
// under a franchise, localized to zh-CN like the seasons route. The collection
// drill-down diffs this against what's tracked to show "what else is in here".
tmdbRoutes.get("/collection/:id", async (c) => {
  const apiKey = c.env.TMDB_API_KEY;
  if (!apiKey) {
    return c.json({ error: "TMDB integration is not configured" }, 503);
  }
  const idParam = c.req.param("id");
  if (!/^[1-9][0-9]*$/.test(idParam)) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }

  let collection;
  try {
    collection = await getTmdbCollection(Number(idParam), {
      apiKey,
      language: "zh-CN",
    });
  } catch {
    return c.json({ error: "TMDB request failed" }, 502);
  }
  if (collection === null) {
    return c.json({ error: "collection not found on TMDB" }, 404);
  }

  const parts = (collection.parts ?? []).map((p) => ({
    id: p.id,
    title: p.title ?? p.original_title ?? null,
    release_date: p.release_date ?? null,
    poster_path: p.poster_path ?? null,
    vote_average: p.vote_average ?? null,
  }));
  return c.json({ name: stripCollectionSuffix(collection.name ?? null), parts });
});

// GET /api/tmdb/existing?ids=movie:550,tv:1399:s2 → { existing: [...] }
// "Which of these am I already tracking?" — a pure D1 lookup, mirroring
// /api/anilist/existing. Lets the gap scan drop entries that are in the library
// but filed under a different collection, instead of offering a doomed Add.
tmdbRoutes.get("/existing", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const existing = await findExistingExternalIds(c.env.DB, "tmdb", ids);
  return c.json({ existing: [...existing] });
});
