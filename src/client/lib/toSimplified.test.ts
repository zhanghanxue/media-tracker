import { beforeAll, describe, expect, it } from "vitest";

import { toSimplified } from "./toSimplified";

// Real OpenCC (no mock) — it's a pure data transform over a bundled dictionary,
// so exercising the actual library is the honest test (TESTING.md: don't mock
// what you can run for real).
//
// Warm the lazy OpenCC dictionary once up front: the first dynamic import loads
// a ~1 MB bundle which, under the full parallel suite, can exceed the default
// 5s test timeout. After warm-up the converter is memoized, so each test is
// instant. (Generous hook timeout — it's a one-time import, not logic.)
beforeAll(async () => {
  await toSimplified("預熱");
}, 30000);

describe("toSimplified", () => {
  it("converts Traditional characters to Simplified (鬼滅之刃 → 鬼灭之刃)", async () => {
    // Bangumi's legacy `name_cn` for Demon Slayer uses the traditional 滅.
    expect(await toSimplified("鬼滅之刃")).toBe("鬼灭之刃");
  });

  it("leaves already-Simplified text unchanged", async () => {
    expect(await toSimplified("鬼灭之刃")).toBe("鬼灭之刃");
  });

  it("converts a longer mixed title", async () => {
    // 進擊的巨人 (traditional) → 进击的巨人 (simplified)
    expect(await toSimplified("進擊的巨人")).toBe("进击的巨人");
  });

  it("returns empty / whitespace input as-is without converting", async () => {
    expect(await toSimplified("")).toBe("");
    expect(await toSimplified("   ")).toBe("   ");
  });
});
