// AniList proxy routes. The browser can't call graphql.anilist.co directly
// (no CORS for arbitrary origins), so the Worker proxies search — and while
// it's here, annotates each result with whether it's already in the library
// so the modal can show "Already added" instead of an Add button.

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import { findExistingExternalIds } from "../db/media-repository";
import { searchAniList, type AniListMediaType } from "../sources/anilist";

export const anilistRoutes = new Hono<{
  Bindings: AppEnv;
  Variables: AuthVariables;
}>();

anilistRoutes.get("/search", async (c) => {
  const q = c.req.query("q")?.trim();
  const type = c.req.query("type");

  if (!q) {
    return c.json({ error: "q is required" }, 400);
  }
  if (type !== "ANIME" && type !== "MANGA") {
    return c.json({ error: "type must be ANIME or MANGA" }, 400);
  }

  // 25 (vs the client default of 10) gives headroom so a relevance-ranked
  // result sitting just past the top 10 still shows. AniList caps perPage at
  // 50. True "load more" pagination is a deferred v1.x add-on (see PLAN.md).
  const results = await searchAniList(q, type as AniListMediaType, {
    perPage: 25,
  });

  // Annotate with library membership in one batched lookup.
  const ids = results.map((r) => String(r.id));
  const existing = await findExistingExternalIds(c.env.DB, "anilist", ids);

  const annotated = results.map((media) => ({
    ...media,
    alreadyAdded: existing.has(String(media.id)),
  }));

  return c.json({ results: annotated });
});
