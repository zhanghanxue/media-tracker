import { defineConfig } from "vitest/config";

// Node environment is sufficient for Phase 3 — AnilistClient mocks `fetch`,
// and AnilistMapper is a pure function. Neither needs D1 in tests.
// Phase 5+ adds `@cloudflare/vitest-pool-workers` for MediaRepository
// integration tests, which require a real D1 binding.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
});
