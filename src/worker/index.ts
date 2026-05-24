import { Hono } from "hono";

// Bindings injected by Cloudflare Workers runtime.
// Phase 1 will add Cf-Access JWT verification middleware on `/api/*`.
// Phase 2 will use DB (D1 binding) for media CRUD.
// Phase 4 will use COVERS (R2 binding) for cover image storage.
type Env = {
  DB: D1Database;
  COVERS: R2Bucket;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => {
  const user = c.req.header("Cf-Access-Authenticated-User-Email") ?? null;
  return c.json({
    ok: true,
    user,
    timestamp: new Date().toISOString(),
  });
});

export default app;
