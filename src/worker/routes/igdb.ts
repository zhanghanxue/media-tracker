// IGDB Worker routes. Like TMDB (and unlike AniList/Bangumi), the Worker proxies
// the search itself — IGDB needs a Twitch-issued token that must never reach the
// browser. The add flow's detail fetch lives in POST /api/media for the same
// reason.

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import {
  getIgdbCollectionGames,
  getIgdbGameSeries,
  searchIgdb,
} from "../sources/igdb";
import { selectSeriesGaps } from "../api/series-gaps";
import { findExistingExternalIds } from "../db/media-repository";

export const igdbRoutes = new Hono<{
  Bindings: AppEnv;
  Variables: AuthVariables;
}>();

/** Comma-separated positive integers from a query param, deduped. */
function parseIdList(raw: string | undefined): number[] {
  const ids = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[1-9][0-9]*$/.test(s))
    .map(Number);
  return [...new Set(ids)];
}

// GET /api/igdb/search?q=... → { results: [...] }
igdbRoutes.get("/search", async (c) => {
  const clientId = c.env.TWITCH_CLIENT_ID;
  const clientSecret = c.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return c.json({ error: "IGDB integration is not configured" }, 503);
  }

  const q = (c.req.query("q") ?? "").trim();
  if (q === "") {
    return c.json({ results: [] });
  }

  try {
    const results = await searchIgdb(q, { clientId, clientSecret });
    return c.json({ results });
  } catch {
    // Upstream IGDB/Twitch failure (rate limit, 5xx, bad creds). Surface as 502
    // so the client shows "search failed" rather than a misleading empty result.
    return c.json({ error: "IGDB search failed" }, 502);
  }
});

// GET /api/igdb/series?ids=1,2,3 → { series: [{ id, name }] }
// Which series the given games belong to, in ONE upstream request. The gap scan
// asks this of a collection's members rather than trusting the collection id:
// only games added since the mapper started stamping "igdb:collection:<id>"
// carry one, and most of the library predates that.
igdbRoutes.get("/series", async (c) => {
  const clientId = c.env.TWITCH_CLIENT_ID;
  const clientSecret = c.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return c.json({ error: "IGDB integration is not configured" }, 503);
  }
  const ids = parseIdList(c.req.query("ids"));
  if (ids.length === 0) return c.json({ series: [] });

  let games;
  try {
    games = await getIgdbGameSeries(ids.slice(0, 300), {
      clientId,
      clientSecret,
    });
  } catch {
    return c.json({ error: "IGDB request failed" }, 502);
  }

  // Flatten game → series into a deduped series list; the client only needs the
  // distinct series to expand next.
  const byId = new Map<number, string | null>();
  for (const g of games) {
    for (const col of g.collections ?? []) {
      if (!byId.has(col.id)) byId.set(col.id, col.name ?? null);
    }
  }
  return c.json({
    series: [...byId].map(([id, name]) => ({ id, name })),
  });
});

// GET /api/igdb/series/:id/games → { games: [...] }
// A series' members, structurally filtered (no editions, DLC, bundles or ports)
// and newest-first. Deliberately NOT rating-filtered — see api/series-gaps.ts.
igdbRoutes.get("/series/:id/games", async (c) => {
  const clientId = c.env.TWITCH_CLIENT_ID;
  const clientSecret = c.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return c.json({ error: "IGDB integration is not configured" }, 503);
  }
  const idParam = c.req.param("id");
  if (!/^[1-9][0-9]*$/.test(idParam)) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }

  try {
    const members = await getIgdbCollectionGames(Number(idParam), {
      clientId,
      clientSecret,
      limit: 200,
    });
    return c.json({ games: selectSeriesGaps(members) });
  } catch {
    return c.json({ error: "IGDB request failed" }, 502);
  }
});

// GET /api/igdb/existing?ids=1,2,3 → { existing: ["1", ...] }
// "Which of these IGDB ids am I already tracking?" — a pure D1 lookup, mirroring
// /api/anilist/existing and /api/tmdb/existing.
igdbRoutes.get("/existing", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const existing = await findExistingExternalIds(c.env.DB, "igdb", ids);
  return c.json({ existing: [...existing] });
});
