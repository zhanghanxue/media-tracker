// Two test projects:
//   • node    — pure functions + fetch-mocked / R2-stub tests (fast, Phase 3/4)
//   • workers — real D1 / R2 integration via @cloudflare/vitest-pool-workers
//
// Include globs are disjoint so no test file runs under both runtimes.

import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "node",
      include: [
        "src/worker/sources/**/*.test.ts",
        "src/worker/storage/**/*.test.ts",
        "src/worker/api/**/*.test.ts",
        // Client-side pure helpers (e.g. displayTitle). NOT React components —
        // those are deliberately untested in v1 (CLAUDE.md / TESTING.md).
        "src/client/lib/**/*.test.ts",
        // Phase 12 import tooling (Node scripts, out of the app bundle).
        "scripts/**/*.test.ts",
      ],
      environment: "node",
    },
  },
  "./vitest.workers.config.ts",
]);
