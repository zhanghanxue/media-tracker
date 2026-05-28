// Type augmentation for the `cloudflare:test` module's `env` object. Tells
// TypeScript which bindings/vars the workers-pool test environment provides —
// the real bindings come from wrangler.toml ([[d1_databases]], [[r2_buckets]],
// [vars]) plus the extras injected via miniflare.bindings in
// vitest.workers.config.ts (LOCAL_DEV_BYPASS, TEST_MIGRATIONS).

/// <reference types="@cloudflare/vitest-pool-workers" />

import type { D1Migration } from "cloudflare:test";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    COVERS: R2Bucket;
    COVERS_PUBLIC_URL_BASE: string;
    LOCAL_DEV_BYPASS: string;
    // Injected by vitest.workers.config.ts via readD1Migrations(); consumed by
    // test/apply-migrations.ts to build the schema in the isolated test DB.
    TEST_MIGRATIONS: D1Migration[];
  }
}
