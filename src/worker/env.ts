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
  // TMDB v4 "API Read Access Token". A Wrangler secret (prod) / .dev.vars (local).
  // Unlike AniList/Bangumi, TMDB is key-bearing so the Worker — not the browser —
  // calls it. May be undefined locally if the dev hasn't set it; the route 503s.
  TMDB_API_KEY?: string;
  // IGDB auth via Twitch OAuth (client_credentials). Both are Wrangler secrets
  // (prod) / .dev.vars (local); the Worker mints a token and calls IGDB itself.
  // Undefined when unconfigured → the igdb routes 503.
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
};
