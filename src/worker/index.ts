import { Hono } from "hono";
import { cfAccessAuth, type AuthVariables } from "./middleware/auth";
import type { AppEnv } from "./env";
import { mediaRoutes } from "./routes/media";
import { anilistRoutes } from "./routes/anilist";
import { tmdbRoutes } from "./routes/tmdb";
import { seriesRoutes } from "./routes/series";

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
// Series rename (the one series-level op that spans rows; link/unlink is on /media).
app.route("/api/series", seriesRoutes);

export default app;
