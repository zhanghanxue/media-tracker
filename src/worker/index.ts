import { Hono } from "hono";
import { cfAccessAuth, type AuthVariables } from "./middleware/auth";
import type { AppEnv } from "./env";
import { mediaRoutes } from "./routes/media";
import { anilistRoutes } from "./routes/anilist";
import { tmdbRoutes } from "./routes/tmdb";
import { igdbRoutes } from "./routes/igdb";
import { collectionsRoutes } from "./routes/collections";
import { recommendRoutes } from "./routes/recommend";
import { suggestionsRoutes } from "./routes/suggestions";

const app = new Hono<{ Bindings: AppEnv; Variables: AuthVariables }>();

// Gate all /api/* routes behind CF Access (production) or LOCAL_DEV_BYPASS (dev).
app.use("/api/*", cfAccessAuth);

app.get("/api/health", (c) => {
  const user = c.get("user");
  return c.json({
    ok: true,
    user: user.email,
    timestamp: new Date().toISOString(),
  });
});

// Phase 5/6: media CRUD + list.
app.route("/api/media", mediaRoutes);
// Phase 8: AniList search proxy (browser can't hit AniList's GraphQL directly).
app.route("/api/anilist", anilistRoutes);
// TMDB search proxy (key-bearing → Worker-side, browser never sees the token).
app.route("/api/tmdb", tmdbRoutes);
// IGDB search proxy (Twitch-OAuth-bearing → Worker-side, same rule as TMDB).
app.route("/api/igdb", igdbRoutes);
// Collections: the nestable grouping tree (create/rename/move/delete + subtree
// bulk-edit). Item↔collection linking is a media PATCH (collection_id).
app.route("/api/collections", collectionsRoutes);
// Feature B (v2): source-native recommendations per type. movie/drama/variety →
// TMDB, game → IGDB (anime recs run in the browser, like the AniList add flow).
app.route("/api/recommendations", recommendRoutes);
// Feature A (v2): "What's New" scanner dismissals (the scan runs browser-side;
// the Worker only persists which suggestions were dismissed).
app.route("/api/suggestions", suggestionsRoutes);

export default app;
