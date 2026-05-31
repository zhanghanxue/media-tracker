// Integration tests for the Feature A dismissal endpoints (real D1 via
// vitest-pool-workers). The scan itself is browser-side, so there's nothing to
// mock here — just the dismissed_suggestions table round-trip + validation.

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../index";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM dismissed_suggestions");
});

async function dismiss(body: unknown): Promise<Response> {
  return app.request(
    "/api/suggestions/dismiss",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe("POST /api/suggestions/dismiss", () => {
  it("persists a dismissal and lists it back as a source:id key", async () => {
    const res = await dismiss({ source: "tmdb", external_id: "tv:1399:s8", kind: "new_season" });
    expect(res.status).toBe(204);

    const list = await app.request("/api/suggestions/dismissed", {}, env);
    const body = (await list.json()) as { dismissed: string[] };
    expect(body.dismissed).toEqual(["tmdb:tv:1399:s8"]);
  });

  it("is idempotent — re-dismissing the same key doesn't error or duplicate", async () => {
    await dismiss({ source: "anilist", external_id: "153406", kind: "sequel" });
    const again = await dismiss({ source: "anilist", external_id: "153406", kind: "sequel" });
    expect(again.status).toBe(204);

    const list = await app.request("/api/suggestions/dismissed", {}, env);
    const body = (await list.json()) as { dismissed: string[] };
    expect(body.dismissed).toEqual(["anilist:153406"]);
  });

  it("400s on a bad source, empty id, or bad kind", async () => {
    expect((await dismiss({ source: "imdb", external_id: "x", kind: "sequel" })).status).toBe(400);
    expect((await dismiss({ source: "tmdb", external_id: "", kind: "sequel" })).status).toBe(400);
    expect((await dismiss({ source: "tmdb", external_id: "x", kind: "bogus" })).status).toBe(400);
  });
});

describe("GET /api/suggestions/dismissed", () => {
  it("returns an empty list when nothing is dismissed", async () => {
    const res = await app.request("/api/suggestions/dismissed", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dismissed: string[] };
    expect(body.dismissed).toEqual([]);
  });
});
