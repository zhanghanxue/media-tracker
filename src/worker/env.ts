// Shared Worker environment type. Bindings + vars injected by the Cloudflare
// Workers runtime, plus the auth middleware's env contract.
//
// Defined here (rather than inline in index.ts) so route modules and storage
// helpers can import the same shape without a circular dependency on the app
// entrypoint. `CoverEnv` (storage/covers.ts) is structurally satisfied by this
// type, so `uploadCoverToR2(env, ...)` accepts an `AppEnv` directly.

import type { AuthEnv } from "./middleware/auth";

export type AppEnv = AuthEnv & {
  DB: D1Database;
  COVERS: R2Bucket;
  COVERS_PUBLIC_URL_BASE: string;
};
