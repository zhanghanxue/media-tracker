// Integration tests for the /api/media routes via vitest-pool-workers.
// Real D1 + real R2 bindings. The Worker no longer calls AniList (the browser
// does, then POSTs the media object) — so the only external boundary left is
// the cover image CDN (s4.anilist.co), mocked with fetchMock.
// LOCAL_DEV_BYPASS=1 (miniflare binding) makes the auth middleware pass.

import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import app from "../index";
import { findByExternalRef, insertMedia } from "../db/media-repository";
import type { AniListMapperResult } from "../sources/anilist-mapper";
import detailAnimeFixture from "../../../test/fixtures/anilist/detail_anime_101922.json";

const COVER_ORIGIN = "https://s4.anilist.co";
const COVER_PATH =
  "/file/anilistcdn/media/anime/cover/large/bx101922-WBsBl0ClmgYL.jpg";

// The AniList media object the browser POSTs (search & detail share fields).
const MEDIA = (
  detailAnimeFixture as { data: { Media: Record<string, unknown> } }
).data.Media;

const VALID_BODY = {
  external_source: "anilist",
  status: "planned",
  media: MEDIA,
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
  it("maps the posted media object and returns the row with 201", async () => {
    mockCoverImage();

    const res = await post(VALID_BODY);
    expect(res.status).toBe(201);

    const row = (await res.json()) as Record<string, unknown>;
    expect(row.id).toBeTypeOf("number");
    expect(row.type).toBe("animation"); // derived from format=TV
    expect(row.status).toBe("planned");
    expect(row.external_source).toBe("anilist");
    expect(row.external_id).toBe("101922");
    expect(row.title_romaji).toBe("Kimetsu no Yaiba");
    expect(row.total_episodes).toBe(26);
  });

  it("re-hosts the cover to R2 and stores the public R2 URL", async () => {
    mockCoverImage();

    const res = await post(VALID_BODY);
    const row = (await res.json()) as Record<string, unknown>;

    expect(row.cover_url).toBe(
      "https://covers.zhanghanxue.com/covers/anilist/101922.jpg",
    );
    const head = await env.COVERS.head("covers/anilist/101922.jpg");
    expect(head).not.toBeNull();
  });

  it("actually persists the row (readable via the repository)", async () => {
    mockCoverImage();

    await post(VALID_BODY);

    const stored = await findByExternalRef(env.DB, "anilist", "101922");
    expect(stored).not.toBeNull();
    expect(stored!.title_native).toBe("鬼滅の刃");
  });
});

describe("POST /api/media — conflict", () => {
  it("returns 409 with the existing row on a duplicate (source, media.id)", async () => {
    // Only the first insert uploads a cover; the second short-circuits at the
    // conflict probe, so we register exactly one interceptor.
    mockCoverImage();

    const first = await post(VALID_BODY);
    expect(first.status).toBe(201);
    const firstRow = (await first.json()) as { id: number };

    const second = await post(VALID_BODY);
    expect(second.status).toBe(409);
    const secondRow = (await second.json()) as { id: number };

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

  it("returns 400 when the media object is missing", async () => {
    const res = await post({ external_source: "anilist", status: "planned" });
    expect(res.status).toBe(400);
  });

  it("returns 501 for a valid-but-unimplemented source", async () => {
    const res = await post({ ...VALID_BODY, external_source: "tmdb" });
    expect(res.status).toBe(501);
  });
});

// --- GET routes ------------------------------------------------------------
// These exercise the read path only (no AniList / R2), so no fetchMock
// interceptors are registered. Data is seeded directly via the repository.

const BASE_ROW: AniListMapperResult = {
  type: "animation",
  region: "japan",
  title_native: "鬼滅の刃",
  title_romaji: "Kimetsu no Yaiba",
  title_english: "Demon Slayer",
  title_chinese: null,
  status: "in_progress",
  is_rewatching: 0,
  cover_url: null,
  external_id: "101922",
  external_source: "anilist",
  current_episode: null,
  total_episodes: 26,
  current_chapter: null,
  total_chapters: null,
};

async function get(path: string): Promise<Response> {
  return app.request(path, {}, env);
}

async function patch(path: string, body: unknown): Promise<Response> {
  return app.request(
    path,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function seedThree(): Promise<void> {
  await insertMedia(env.DB, BASE_ROW);
  await insertMedia(env.DB, {
    ...BASE_ROW,
    external_id: "30002",
    type: "manga",
    status: "completed",
    title_english: "Berserk",
    title_native: "ベルセルク",
  });
  await insertMedia(env.DB, {
    ...BASE_ROW,
    external_id: "50000",
    region: "china",
    status: "planned",
    title_english: "Demon's Heart",
    title_native: "魔心",
  });
}

describe("GET /api/media — list", () => {
  it("returns { items, total } for all rows with no filters", async () => {
    await seedThree();
    const res = await get("/api/media");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(3);
  });

  it("applies the type+region+status facet combination (AND across)", async () => {
    await seedThree();
    const res = await get(
      "/api/media?type=animation&region=japan&status=in_progress",
    );
    const body = (await res.json()) as {
      items: { external_id: string }[];
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]!.external_id).toBe("101922");
  });

  it("searches English titles via q=demon (case-insensitive, two matches)", async () => {
    await seedThree();
    const res = await get("/api/media?q=demon");
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(2);
  });

  it("searches native CJK titles via q=鬼滅", async () => {
    await seedThree();
    const res = await get(`/api/media?q=${encodeURIComponent("鬼滅")}`);
    const body = (await res.json()) as {
      items: { external_id: string }[];
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]!.external_id).toBe("101922");
  });

  it("returns 400 with details on an invalid status filter", async () => {
    const res = await get("/api/media?status=banana");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid query");
  });

  it("returns 400 on a bad limit", async () => {
    const res = await get("/api/media?limit=0");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/media/:id — single", () => {
  it("returns the row for a valid id", async () => {
    const inserted = await insertMedia(env.DB, BASE_ROW);
    const res = await get(`/api/media/${inserted.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; external_id: string };
    expect(body.id).toBe(inserted.id);
    expect(body.external_id).toBe("101922");
  });

  it("returns 404 for a non-existent id", async () => {
    const res = await get("/api/media/999999");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await get("/api/media/abc");
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/media/:id", () => {
  it("updates a field and bumps date_updated", async () => {
    const inserted = await insertMedia(env.DB, BASE_ROW);
    await env.DB.exec(
      `UPDATE media SET date_updated = '2020-01-01 00:00:00' WHERE id = ${inserted.id}`,
    );

    const res = await patch(`/api/media/${inserted.id}`, { current_episode: 5 });
    expect(res.status).toBe(200);
    const row = (await res.json()) as Record<string, unknown>;
    expect(row.current_episode).toBe(5);
    expect(row.date_updated).not.toBe("2020-01-01 00:00:00");
  });

  it("does not clobber unrelated fields", async () => {
    const inserted = await insertMedia(env.DB, {
      ...BASE_ROW,
      title_english: "Keep Me",
    });
    const res = await patch(`/api/media/${inserted.id}`, { current_episode: 3 });
    const row = (await res.json()) as Record<string, unknown>;
    expect(row.title_english).toBe("Keep Me");
  });

  it("auto-completes when current_episode reaches total_episodes", async () => {
    // BASE_ROW has total_episodes = 26.
    const inserted = await insertMedia(env.DB, BASE_ROW);
    const res = await patch(`/api/media/${inserted.id}`, {
      current_episode: 26,
    });
    const row = (await res.json()) as { status: string };
    expect(row.status).toBe("completed");
  });

  it("fills current_episode up to the total when marked completed", async () => {
    // BASE_ROW: total_episodes 26, current null.
    const inserted = await insertMedia(env.DB, BASE_ROW);
    const res = await patch(`/api/media/${inserted.id}`, {
      status: "completed",
    });
    const row = (await res.json()) as {
      status: string;
      current_episode: number;
    };
    expect(row.status).toBe("completed");
    expect(row.current_episode).toBe(26);
  });

  it("respects an explicit status over auto-complete", async () => {
    const inserted = await insertMedia(env.DB, BASE_ROW);
    const res = await patch(`/api/media/${inserted.id}`, {
      current_episode: 26,
      status: "paused",
    });
    const row = (await res.json()) as { status: string };
    expect(row.status).toBe("paused");
  });

  it("returns 404 for a missing id", async () => {
    const res = await patch("/api/media/999999", { current_episode: 1 });
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid status", async () => {
    const inserted = await insertMedia(env.DB, BASE_ROW);
    const res = await patch(`/api/media/${inserted.id}`, { status: "banana" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty patch", async () => {
    const inserted = await insertMedia(env.DB, BASE_ROW);
    const res = await patch(`/api/media/${inserted.id}`, {});
    expect(res.status).toBe(400);
  });

  it("returns 400 for an unknown field (e.g. video_url)", async () => {
    const inserted = await insertMedia(env.DB, BASE_ROW);
    const res = await patch(`/api/media/${inserted.id}`, {
      video_url: "https://x",
    });
    expect(res.status).toBe(400);
  });
});
