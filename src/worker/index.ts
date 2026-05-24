import { Hono } from "hono";
import { cfAccessAuth, type AuthEnv, type AuthVariables } from "./middleware/auth";

// Bindings injected by Cloudflare Workers runtime.
// Phase 2 will use DB (D1 binding) for media CRUD.
// Phase 4 will use COVERS (R2 binding) for cover image storage.
type Env = AuthEnv & {
  DB: D1Database;
  COVERS: R2Bucket;
};

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

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

export default app;
