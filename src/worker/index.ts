import { Hono } from "hono";
import { cfAccessAuth, type AuthVariables } from "./middleware/auth";
import type { AppEnv } from "./env";
import { mediaRoutes } from "./routes/media";

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

// Phase 5: add media from an external source (AniList in v1).
app.route("/api/media", mediaRoutes);

export default app;
