// TMDB Worker routes. UNLIKE the AniList route (which only does a D1 lookup
// because the browser calls AniList directly), the Worker proxies TMDB search
// itself — TMDB is key-bearing and the key must never reach the browser. The
// add flow's detail fetch lives in POST /api/media for the same reason.

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import { getTmdbDetail, searchTmdb, type TmdbKind } from "../sources/tmdb";

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
