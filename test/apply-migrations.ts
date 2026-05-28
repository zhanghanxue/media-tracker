// Setup file for the workers-pool test project. Runs once per test file,
// before any test, and builds the real schema in that file's isolated D1 by
// replaying migrations/*.sql. applyD1Migrations is idempotent (it tracks
// applied migrations in d1_migrations), mirroring `wrangler d1 migrations apply`.

import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
