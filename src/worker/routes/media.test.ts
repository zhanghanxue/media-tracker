// Integration tests for POST /api/media via vitest-pool-workers.
// Real D1 + real R2 bindings; only the external boundaries are mocked:
//   • AniList GraphQL endpoint (graphql.anilist.co) — fetchMock
//   • cover image CDN (s4.anilist.co)               — fetchMock
// LOCAL_DEV_BYPASS=1 (miniflare binding) makes the auth middleware pass.

import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import app from "../index";
import { findByExternalRef } from "../db/media-repository";
import detailAnimeFixture from "../../../test/fixtures/anilist/detail_anime_101922.json";

const ANILIST_ORIGIN = "https://graphql.anilist.co";
const COVER_ORIGIN = "https://s4.anilist.co";
const COVER_PATH =
  "/file/anilistcdn/media/anime/cover/large/bx101922-WBsBl0ClmgYL.jpg";

const VALID_BODY = {
  external_source: "anilist",
  external_id: 101922,
  type: "animation",
  status: "planned",
};

async function post(body: unknown): Promise<Response> {
  return app.request(
    "/api/media",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

// Intercept the AniList detail query, returning the captured fixture.
function mockAniListDetail(payload: object = detailAnimeFixture): void {
  fetchMock
    .get(ANILIST_ORIGIN)
    .intercept({ method: "POST", path: "/" })
    .reply(200, payload, {
      headers: { "content-type": "application/json" },
    });
}

// Intercept the cover image download.
function mockCoverImage(): void {
  fetchMock
    .get(COVER_ORIGIN)
    .intercept({ method: "GET", path: COVER_PATH })
    .reply(200, "fake-image-bytes", {
      headers: { "content-type": "image/jpeg" },
    });
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(async () => {
  await env.DB.exec("DELETE FROM media");
});

afterEach(() => {
  // Fail loudly if a test registered an interceptor it never used — that means
  // the handler didn't make the external call we expected.
  fetchMock.assertNoPendingInterceptors();
});

describe("POST /api/media — happy path", () => {
  it("creates a row from an AniList id and returns it with 201", async () => {
    mockAniListDetail();
    mockCoverImage();

    const res = await post(VALID_BODY);
    expect(res.status).toBe(201);

    const row = (await res.json()) as Record<string, unknown>;
    expect(row.id).toBeTypeOf("number");
    expect(row.type).toBe("animation");
    expect(row.status).toBe("planned");
    expect(row.external_source).toBe("anilist");
    expect(row.external_id).toBe("101922");
    expect(row.title_romaji).toBe("Kimetsu no Yaiba");
    expect(row.total_episodes).toBe(26);
  });

  it("re-hosts the cover to R2 and stores the public R2 URL", async () => {
    mockAniListDetail();
    mockCoverImage();

    const res = await post(VALID_BODY);
    const row = (await res.json()) as Record<string, unknown>;

    expect(row.cover_url).toBe(
      "https://covers.zhanghanxue.com/covers/anilist/101922.jpg",
    );
    // The object actually landed in R2 under the expected key.
    const head = await env.COVERS.head("covers/anilist/101922.jpg");
    expect(head).not.toBeNull();
  });

  it("actually persists the row (readable via the repository)", async () => {
    mockAniListDetail();
    mockCoverImage();

    await post(VALID_BODY);

    const stored = await findByExternalRef(env.DB, "anilist", "101922");
    expect(stored).not.toBeNull();
    expect(stored!.title_native).toBe("鬼滅の刃");
  });
});

describe("POST /api/media — conflict", () => {
  it("returns 409 with the existing row on a duplicate (source, external_id)", async () => {
    // Only the FIRST insert touches AniList + the CDN; the second short-circuits
    // at the conflict probe, so we register exactly one set of interceptors.
    mockAniListDetail();
    mockCoverImage();

    const first = await post(VALID_BODY);
    expect(first.status).toBe(201);
    const firstRow = (await first.json()) as { id: number };

    const second = await post(VALID_BODY);
    expect(second.status).toBe(409);
    const secondRow = (await second.json()) as { id: number };

    // Same row returned, not a duplicate insert.
    expect(secondRow.id).toBe(firstRow.id);
  });
});

describe("POST /api/media — validation & routing errors", () => {
  it("returns 400 with details for an invalid status", async () => {
    const res = await post({ ...VALID_BODY, status: "banana" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: string[] };
    expect(body.error).toBe("validation failed");
    expect(body.details.some((d) => d.startsWith("status must be"))).toBe(true);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await app.request(
      "/api/media",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ not json",
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 501 for a valid-but-unimplemented source", async () => {
    const res = await post({ ...VALID_BODY, external_source: "tmdb" });
    expect(res.status).toBe(501);
  });

  it("returns 400 for a type AniList can't serve (movie)", async () => {
    const res = await post({ ...VALID_BODY, type: "movie" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when AniList has no media with that id", async () => {
    // AniList responds with data.Media = null for an unknown id.
    mockAniListDetail({ data: { Media: null } });

    const res = await post({ ...VALID_BODY, external_id: 999999999 });
    expect(res.status).toBe(404);
  });
});
