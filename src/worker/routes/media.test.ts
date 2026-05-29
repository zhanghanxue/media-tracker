// Integration tests for the /api/media routes via vitest-pool-workers.
// Real D1 + real R2 bindings. The Worker no longer calls AniList (the browser
// does, then POSTs the media object) — so the only external boundary left is
// the cover image CDN (s4.anilist.co), mocked with fetchMock.
// LOCAL_DEV_BYPASS=1 (miniflare binding) makes the auth middleware pass.

import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import app from "../index";
import { findById, findByExternalRef, insertMedia } from "../db/media-repository";
import type { AniListMapperResult } from "../sources/anilist-mapper";
import detailAnimeFixture from "../../../test/fixtures/anilist/detail_anime_101922.json";
import tmdbMovieDetailFixture from "../../../test/fixtures/tmdb/detail_movie_496243.json";

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

  it("fills progress to the total when added as completed", async () => {
    mockCoverImage();

    const res = await post({ ...VALID_BODY, status: "completed" });
    const row = (await res.json()) as Record<string, unknown>;
    expect(row.status).toBe("completed");
    expect(row.current_episode).toBe(26); // total_episodes from the fixture
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

  it("returns 501 for a valid-but-unimplemented source (igdb)", async () => {
    const res = await post({ ...VALID_BODY, external_source: "igdb" });
    expect(res.status).toBe(501);
  });
});

// --- Bangumi source (Option A: Chinese donghua/manhua AniList lacks) -------

const BGM_COVER_ORIGIN = "https://lain.bgm.tv";
const BGM_COVER_PATH = "/pic/cover/l/9d/d1/245665_5an54.jpg";

// A Bangumi subject as the browser POSTs it — note the shape differs from
// AniList (name/name_cn/images, no title/coverImage). name_cn is already
// Simplified because the browser ran it through toSimplified() first.
const BGM_BODY = {
  external_source: "bangumi",
  status: "planned",
  media: {
    id: 245665,
    type: 2,
    name: "鬼滅の刃",
    name_cn: "鬼灭之刃",
    platform: "TV",
    eps: 26,
    total_episodes: 26,
    images: {
      large: `${BGM_COVER_ORIGIN}${BGM_COVER_PATH}`,
      common: null,
      medium: null,
      small: null,
      grid: null,
    },
  },
};

function mockBangumiCover(): void {
  fetchMock
    .get(BGM_COVER_ORIGIN)
    .intercept({ method: "GET", path: BGM_COVER_PATH })
    .reply(200, "fake-image-bytes", {
      headers: { "content-type": "image/jpeg" },
    });
}

describe("POST /api/media — Bangumi source", () => {
  it("maps the Bangumi subject to an animation row (region unset) with 201", async () => {
    mockBangumiCover();

    const res = await post(BGM_BODY);
    expect(res.status).toBe(201);

    const row = (await res.json()) as Record<string, unknown>;
    expect(row.type).toBe("animation");
    expect(row.region).toBeNull(); // unknown by default for Bangumi-direct adds
    expect(row.external_source).toBe("bangumi");
    expect(row.external_id).toBe("245665");
    expect(row.title_native).toBe("鬼滅の刃");
    expect(row.title_chinese).toBe("鬼灭之刃");
    expect(row.total_episodes).toBe(26);
  });

  it("re-hosts the Bangumi cover to R2 under the bangumi/ prefix", async () => {
    mockBangumiCover();

    const res = await post(BGM_BODY);
    const row = (await res.json()) as Record<string, unknown>;

    expect(row.cover_url).toBe(
      "https://covers.zhanghanxue.com/covers/bangumi/245665.jpg",
    );
    const head = await env.COVERS.head("covers/bangumi/245665.jpg");
    expect(head).not.toBeNull();
  });

  it("dedups a Bangumi item independently of AniList (same id, different source)", async () => {
    mockBangumiCover();

    const first = await post(BGM_BODY);
    expect(first.status).toBe(201);

    const second = await post(BGM_BODY);
    expect(second.status).toBe(409);
  });
});

// --- TMDB source (movies / drama; key-bearing → Worker fetches detail) ------

const TMDB_API_ORIGIN = "https://api.themoviedb.org";
const TMDB_IMG_ORIGIN = "https://image.tmdb.org";
const TMDB_POSTER_PATH = "/t/p/w500/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg";

// The browser POSTs only id + kind; the Worker fetches the rest from TMDB.
const TMDB_BODY = {
  external_source: "tmdb",
  status: "completed",
  media: { id: 496243, media_type: "movie" },
};

// Intercept the Worker → TMDB detail call (Authorization header not matched).
function mockTmdbMovieDetail(): void {
  fetchMock
    .get(TMDB_API_ORIGIN)
    .intercept({
      method: "GET",
      path: "/3/movie/496243",
      query: { append_to_response: "translations" },
    })
    .reply(200, JSON.stringify(tmdbMovieDetailFixture), {
      headers: { "content-type": "application/json" },
    });
}

function mockTmdbPoster(): void {
  fetchMock
    .get(TMDB_IMG_ORIGIN)
    .intercept({ method: "GET", path: TMDB_POSTER_PATH })
    .reply(200, "fake-image-bytes", {
      headers: { "content-type": "image/jpeg" },
    });
}

describe("POST /api/media — TMDB source", () => {
  it("fetches detail, maps a movie row, and returns 201", async () => {
    mockTmdbMovieDetail();
    mockTmdbPoster();

    const res = await post(TMDB_BODY);
    expect(res.status).toBe(201);

    const row = (await res.json()) as Record<string, unknown>;
    expect(row.type).toBe("movie");
    expect(row.region).toBe("korea"); // origin_country KR
    expect(row.external_source).toBe("tmdb");
    expect(row.external_id).toBe("movie:496243"); // kind-prefixed
    expect(row.title_native).toBe("기생충");
    expect(row.title_english).toBe("Parasite");
    expect(row.title_chinese).toBe("寄生虫"); // zh-CN, not the zh-TW variant
    expect(row.runtime_minutes).toBe(133);
  });

  it("re-hosts the poster to R2 with a colon-free key", async () => {
    mockTmdbMovieDetail();
    mockTmdbPoster();

    const res = await post(TMDB_BODY);
    const row = (await res.json()) as Record<string, unknown>;

    expect(row.cover_url).toBe(
      "https://covers.zhanghanxue.com/covers/tmdb/movie_496243.jpg",
    );
    const head = await env.COVERS.head("covers/tmdb/movie_496243.jpg");
    expect(head).not.toBeNull();
  });

  it("dedups on the kind-prefixed key (re-add costs no TMDB call)", async () => {
    mockTmdbMovieDetail();
    mockTmdbPoster();

    const first = await post(TMDB_BODY);
    expect(first.status).toBe(201);

    // Second add short-circuits at the conflict probe — no detail/poster fetch,
    // so we register no further interceptors (assertNoPendingInterceptors passes).
    const second = await post(TMDB_BODY);
    expect(second.status).toBe(409);
  });

  it("returns 404 when TMDB has no such id", async () => {
    fetchMock
      .get(TMDB_API_ORIGIN)
      .intercept({
        method: "GET",
        path: "/3/movie/999999999",
        query: { append_to_response: "translations" },
      })
      .reply(404, JSON.stringify({ status_code: 34 }), {
        headers: { "content-type": "application/json" },
      });

    const res = await post({
      external_source: "tmdb",
      status: "planned",
      media: { id: 999999999, media_type: "movie" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when media_type is invalid", async () => {
    const res = await post({
      external_source: "tmdb",
      status: "planned",
      media: { id: 1, media_type: "podcast" },
    });
    expect(res.status).toBe(400);
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
  runtime_minutes: null,
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

  it("updates title_chinese (the Bangumi enricher write path)", async () => {
    // BASE_ROW.title_chinese is null — the enricher fills it.
    const inserted = await insertMedia(env.DB, BASE_ROW);
    const res = await patch(`/api/media/${inserted.id}`, {
      title_chinese: "鬼灭之刃",
    });
    expect(res.status).toBe(200);
    const row = (await res.json()) as Record<string, unknown>;
    expect(row.title_chinese).toBe("鬼灭之刃");
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

async function del(path: string): Promise<Response> {
  return app.request(path, { method: "DELETE" }, env);
}

describe("DELETE /api/media/:id", () => {
  it("removes the row and returns 204", async () => {
    const inserted = await insertMedia(env.DB, BASE_ROW);
    const res = await del(`/api/media/${inserted.id}`);
    expect(res.status).toBe(204);
    expect(await findById(env.DB, inserted.id)).toBeNull();
  });

  it("returns 404 when the id doesn't exist", async () => {
    const res = await del("/api/media/999999");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await del("/api/media/abc");
    expect(res.status).toBe(400);
  });
});
