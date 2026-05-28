// AniList-related Worker routes. NOTE: the Worker does NOT proxy AniList search
// anymore — AniList blocks Cloudflare Worker egress IPs (returns 403). The
// browser calls AniList directly (it allows CORS). All the Worker does here is
// answer "which of these AniList ids are already in my library?" so the add
// modal can show "In library" — a pure D1 lookup, no outbound AniList call.

import { Hono } from "hono";

import type { AppEnv } from "../env";
import type { AuthVariables } from "../middleware/auth";
import { findExistingExternalIds } from "../db/media-repository";

export const anilistRoutes = new Hono<{
  Bindings: AppEnv;
  Variables: AuthVariables;
}>();

// GET /api/anilist/existing?ids=1,2,3 → { existing: ["1", ...] }
anilistRoutes.get("/existing", async (c) => {
  const idsParam = c.req.query("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const existing = await findExistingExternalIds(c.env.DB, "anilist", ids);
  return c.json({ existing: [...existing] });
});
