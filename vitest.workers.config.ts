// Workers-pool test project: integration tests that need a REAL D1 / R2,
// running inside workerd (not node). Covers MediaRepository (src/worker/db)
// and the Hono route handlers (src/worker/routes). Pure-function and
// fetch-mocked tests stay in the fast `node` project (see vitest.workspace.ts).

import {
  defineWorkersProject,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";
import { fileURLToPath } from "node:url";

export default defineWorkersProject(async () => {
  // Read + parse migrations at config time so they can be handed to the test
  // worker as a binding (workerd can't read the filesystem at runtime).
  const migrationsPath = fileURLToPath(new URL("./migrations", import.meta.url));
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      name: "workers",
      include: [
        "src/worker/db/**/*.test.ts",
        "src/worker/routes/**/*.test.ts",
      ],
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          // Reuse the real wrangler config so bindings (DB, COVERS) and vars
          // (COVERS_PUBLIC_URL_BASE) match production shapes exactly.
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              // Bypass CF Access JWT verification in tests — same switch local
              // dev uses. The auth middleware short-circuits when this is "1".
              LOCAL_DEV_BYPASS: "1",
              // A dummy TMDB token so the tmdb routes are "configured" in tests;
              // the actual TMDB HTTP calls are intercepted via fetchMock.
              TMDB_API_KEY: "test-tmdb-token",
              // Dummy Twitch/IGDB creds so the igdb routes are "configured";
              // the Twitch token + IGDB HTTP calls are intercepted via fetchMock.
              TWITCH_CLIENT_ID: "test-twitch-id",
              TWITCH_CLIENT_SECRET: "test-twitch-secret",
            },
          },
        },
      },
    },
  };
});
