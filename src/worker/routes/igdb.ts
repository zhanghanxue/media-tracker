// IGDB Worker routes. Like TMDB (and unlike AniList/Bangumi), the Worker proxies
// the search itself — IGDB needs a Twitch-issued token that must never reach the
// browser. The add flow's detail fetch lives in POST /api/media for the same
// reason.

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import { searchIgdb } from "../sources/igdb";

export const igdbRoutes = new Hono<{
  Bindings: AppEnv;
  Variables: AuthVariables;
}>();

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
