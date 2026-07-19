// Integration tests for the /api/media routes via vitest-pool-workers.
// Real D1 + real R2 bindings. The Worker no longer calls AniList (the browser
// does, then POSTs the media object) — so the only external boundary left is
// the cover image CDN (s4.anilist.co), mocked with fetchMock.
// LOCAL_DEV_BYPASS=1 (miniflare binding) makes the auth middleware pass.

import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import app from "../index";
import {
  findById,
  findByExternalRef,
  insertCollection,
  insertMedia,
} from "../db/media-repository";
import { resetIgdbTokenCache } from "../sources/igdb";
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
  // The IGDB client caches the Twitch token module-side; clear it so each igdb
  // test mints a fresh one (and its token interceptor is actually consumed).
  resetIgdbTokenCache();
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
    .intercept({ method: "GET", path: /^\/3\/movie\/496243/ })
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

  // Franchise grouping: a movie carrying belongs_to_collection must land in
  // "tmdb:collection:<id>" AND have that collection row created before insert,
  // so the FK the client reads back actually resolves.
  describe("franchise grouping", () => {
    // Rocky (1366) in the Rocky Collection (1575), reusing the captured
    // Parasite payload for every other field.
    const ROCKY_ID = 1366;
    const rockyDetail = {
      ...(tmdbMovieDetailFixture as Record<string, unknown>),
      id: ROCKY_ID,
      belongs_to_collection: { id: 1575, name: "Rocky Collection" },
    };

    function mockRockyDetail(): void {
      fetchMock
        .get(TMDB_API_ORIGIN)
        .intercept({ method: "GET", path: new RegExp(`^/3/movie/${ROCKY_ID}`) })
        .reply(200, JSON.stringify(rockyDetail), {
          headers: { "content-type": "application/json" },
        });
    }

    function mockRockyPoster(): void {
      fetchMock
        .get(TMDB_IMG_ORIGIN)
        .intercept({ method: "GET", path: TMDB_POSTER_PATH })
        .reply(200, "fake-image-bytes", {
          headers: { "content-type": "image/jpeg" },
        });
    }

    it("assigns the franchise collection and creates the collection row", async () => {
      mockRockyDetail();
      mockRockyPoster();

      const res = await post({
        external_source: "tmdb",
        status: "completed",
        media: { id: ROCKY_ID, media_type: "movie" },
      });
      expect(res.status).toBe(201);

      const row = (await res.json()) as Record<string, unknown>;
      expect(row.collection_id).toBe("tmdb:collection:1575");

      // The row must exist, else the media FK dangles and the client can't
      // render (or rename) the group.
      const collections = await app.request("/api/collections", {}, env);
      const { collections: list } = (await collections.json()) as {
        collections: { id: string }[];
      };
      expect(list.map((c) => c.id)).toContain("tmdb:collection:1575");
    });

    it("puts a second film of the franchise in the same collection", async () => {
      mockRockyDetail();
      mockRockyPoster();
      const first = await post({
        external_source: "tmdb",
        status: "completed",
        media: { id: ROCKY_ID, media_type: "movie" },
      });
      expect(first.status).toBe(201);

      // Rocky II — same franchise, different film.
      const sequelId = 1367;
      fetchMock
        .get(TMDB_API_ORIGIN)
        .intercept({ method: "GET", path: new RegExp(`^/3/movie/${sequelId}`) })
        .reply(200, JSON.stringify({ ...rockyDetail, id: sequelId }), {
          headers: { "content-type": "application/json" },
        });
      mockRockyPoster();

      const second = await post({
        external_source: "tmdb",
        status: "planned",
        media: { id: sequelId, media_type: "movie" },
      });
      expect(second.status).toBe(201);

      const a = (await first.json()) as Record<string, unknown>;
      const b = (await second.json()) as Record<string, unknown>;
      expect(b.collection_id).toBe(a.collection_id);
      // ensureCollection is idempotent — still exactly one row.
      const collections = await app.request("/api/collections", {}, env);
      const { collections: list } = (await collections.json()) as {
        collections: { id: string }[];
      };
      expect(list.filter((c) => c.id === "tmdb:collection:1575")).toHaveLength(
        1,
      );
    });
  });

  it("returns 404 when TMDB has no such id", async () => {
    fetchMock
      .get(TMDB_API_ORIGIN)
      .intercept({ method: "GET", path: /^\/3\/movie\/999999999/ })
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

  it("adds a single season pre-linked into the show's series", async () => {
    const showResp = {
      id: 211089,
      original_name: "唐朝诡事录",
      original_language: "zh",
      origin_country: ["CN"],
      poster_path: "/show.jpg",
      translations: {
        translations: [
          { iso_639_1: "en", iso_3166_1: "US", data: { name: "Strange Tales of Tang Dynasty" } },
          { iso_639_1: "zh", iso_3166_1: "CN", data: { name: "唐朝诡事录" } },
        ],
      },
      seasons: [
        { season_number: 1, name: "第 1 季", episode_count: 36, poster_path: "/s1.jpg" },
        { season_number: 2, name: "西行", episode_count: 40, poster_path: "/s2.jpg" },
      ],
    };
    const seasonResp = {
      id: 999,
      season_number: 2,
      name: "To The West",
      poster_path: "/s2.jpg",
      translations: {
        translations: [
          { iso_639_1: "en", iso_3166_1: "US", data: { name: "To The West" } },
          { iso_639_1: "zh", iso_3166_1: "CN", data: { name: "西行" } },
        ],
      },
    };
    fetchMock
      .get(TMDB_API_ORIGIN)
      .intercept({ method: "GET", path: /^\/3\/tv\/211089\?/ })
      .reply(200, JSON.stringify(showResp), { headers: { "content-type": "application/json" } });
    fetchMock
      .get(TMDB_API_ORIGIN)
      .intercept({ method: "GET", path: /^\/3\/tv\/211089\/season\/2/ })
      .reply(200, JSON.stringify(seasonResp), { headers: { "content-type": "application/json" } });
    fetchMock
      .get(TMDB_IMG_ORIGIN)
      .intercept({ method: "GET", path: "/t/p/w500/s2.jpg" })
      .reply(200, "img", { headers: { "content-type": "image/jpeg" } });

    const res = await post({
      external_source: "tmdb",
      status: "in_progress",
      media: { id: 211089, media_type: "tv", season_number: 2 },
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as Record<string, unknown>;
    expect(row.type).toBe("drama");
    expect(row.external_id).toBe("tv:211089:s2");
    expect(row.collection_id).toBe("tmdb:tv:211089");
    expect(row.sort_order).toBe(2);
    expect(row.total_episodes).toBe(40);
    expect(row.title_chinese).toBe("唐朝诡事录 西行");
  });
});

// --- IGDB source (games; Twitch-OAuth-bearing → Worker fetches token + detail) -

const TWITCH_ORIGIN = "https://id.twitch.tv";
const IGDB_API_ORIGIN = "https://api.igdb.com";
const IGDB_IMG_ORIGIN = "https://images.igdb.com";

function mockTwitchToken(): void {
  fetchMock
    .get(TWITCH_ORIGIN)
    .intercept({ method: "POST", path: /^\/oauth2\/token/ })
    .reply(200, JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
      headers: { "content-type": "application/json" },
    });
}

function mockIgdbDetail(game: Record<string, unknown>): void {
  fetchMock
    .get(IGDB_API_ORIGIN)
    .intercept({ method: "POST", path: "/v4/games" })
    .reply(200, JSON.stringify([game]), {
      headers: { "content-type": "application/json" },
    });
}

function mockIgdbCover(imageId: string): void {
  fetchMock
    .get(IGDB_IMG_ORIGIN)
    .intercept({
      method: "GET",
      path: `/igdb/image/upload/t_cover_big/${imageId}.jpg`,
    })
    .reply(200, "img", { headers: { "content-type": "image/jpeg" } });
}

describe("POST /api/media — IGDB source", () => {
  it("mints a token, fetches detail, and maps a game row with the chosen fields", async () => {
    mockTwitchToken();
    mockIgdbDetail({ id: 1942, name: "The Witcher 3", cover: { id: 1, image_id: "cowit" } });
    mockIgdbCover("cowit");

    const res = await post({
      external_source: "igdb",
      status: "in_progress",
      media: { id: 1942, consumption_mode: "playing", platform: "pc" },
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as Record<string, unknown>;
    expect(row.type).toBe("game");
    expect(row.title_english).toBe("The Witcher 3");
    expect(row.consumption_mode).toBe("playing");
    expect(row.platform).toBe("pc");
    expect(row.external_source).toBe("igdb");
    expect(row.external_id).toBe("1942");
    expect(row.cover_url).toBe(
      "https://covers.zhanghanxue.com/covers/igdb/1942.jpg",
    );
  });

  it("returns 404 when IGDB has no such game (empty result)", async () => {
    mockTwitchToken();
    fetchMock
      .get(IGDB_API_ORIGIN)
      .intercept({ method: "POST", path: "/v4/games" })
      .reply(200, "[]", { headers: { "content-type": "application/json" } });

    const res = await post({
      external_source: "igdb",
      status: "planned",
      media: { id: 999999, consumption_mode: "playing", platform: null },
    });
    expect(res.status).toBe(404);
  });

  it("validates consumption_mode (400 on a bad value)", async () => {
    const res = await post({
      external_source: "igdb",
      status: "planned",
      media: { id: 5, consumption_mode: "banana", platform: null },
    });
    expect(res.status).toBe(400);
  });

  it("validates platform (400 on an unknown bucket)", async () => {
    const res = await post({
      external_source: "igdb",
      status: "planned",
      media: { id: 5, consumption_mode: "playing", platform: "switch" },
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
  release_date: null,
  source_rating: null,
  genres: null,
  platform: null,
  consumption_mode: null,
  collection_id: null,
  sort_order: null,
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

// Whole-library sweeps (the backfills, auto-link, What's New) page through with
// LIMIT/OFFSET. That is only correct if the ORDER BY is a TOTAL order — with a
// tied final key SQLite may order tied rows differently per query, so a row can
// appear on two pages or on none. Every sort therefore ends in `id ASC`.
//
// Caveat on what these prove: they still PASS without the tiebreak, because at
// this size SQLite happens to walk a tied full scan in rowid order. They are
// end-to-end regression guards against gaps/duplicates, not a demonstration of
// the bug — the discriminating test is in media-query-builder.test.ts, which
// asserts the clause shape directly and fails without it. Don't rely on these
// to catch a future sort that drops the tiebreak.
describe("GET /api/media — pagination is stable across tied sort keys", () => {
  // 7 rows sharing ONE title and one release_date: every sort key below ties for
  // all of them, so only the id tiebreak can make paging deterministic.
  async function seedTied(n = 7): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const inserted = await insertMedia(env.DB, {
        ...BASE_ROW,
        external_id: `tied-${i}`,
        title_english: "Same Title",
        title_native: null,
        title_romaji: null,
        title_chinese: null,
        release_date: "2020-01-01",
      });
      ids.push(inserted.id);
    }
    return ids;
  }

  for (const sort of ["title", "release_date", "date_added", "status"] as const) {
    it(`walks every row exactly once with sort=${sort}`, async () => {
      const expected = await seedTied();
      const seen: number[] = [];
      for (let offset = 0; offset < expected.length; offset += 2) {
        const res = await get(`/api/media?sort=${sort}&limit=2&offset=${offset}`);
        const body = (await res.json()) as { items: { id: number }[] };
        seen.push(...body.items.map((r) => r.id));
      }
      // No duplicates, no gaps — the whole set, once each.
      expect(new Set(seen).size).toBe(expected.length);
      expect([...seen].sort((a, b) => a - b)).toEqual(
        [...expected].sort((a, b) => a - b),
      );
    });
  }

  it("returns a page slice consistent with the full list", async () => {
    await seedTied();
    const full = (await (await get("/api/media?sort=title&limit=50")).json()) as {
      items: { id: number }[];
    };
    const second = (await (
      await get("/api/media?sort=title&limit=3&offset=3")
    ).json()) as { items: { id: number }[] };
    expect(second.items.map((r) => r.id)).toEqual(
      full.items.slice(3, 6).map((r) => r.id),
    );
  });
});

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

  it("returns exactly the requested ids, ignoring status/collection scope", async () => {
    // One row inside a collection with a non-in_progress status — the id fetch
    // must still return it (session-added pins are scope-unscoped).
    await insertCollection(env.DB, {
      id: "col:pin",
      name: null,
      parent_id: null,
      cover_url: null,
      sort_order: null,
    });
    const a = await insertMedia(env.DB, {
      ...BASE_ROW,
      external_id: "pin1",
      status: "planned",
      collection_id: "col:pin",
    });
    const b = await insertMedia(env.DB, {
      ...BASE_ROW,
      external_id: "pin2",
      status: "dropped",
    });
    await insertMedia(env.DB, { ...BASE_ROW, external_id: "other" });

    const res = await get(`/api/media?id=${a.id}&id=${b.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: number }[];
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("returns 400 on a non-numeric id", async () => {
    const res = await get("/api/media?id=abc");
    expect(res.status).toBe(400);
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

describe("PATCH /api/media/bulk", () => {
  it("applies one patch (collection + status) to many rows, leaving others", async () => {
    const a = await insertMedia(env.DB, { ...BASE_ROW, external_id: "b1" });
    const b = await insertMedia(env.DB, { ...BASE_ROW, external_id: "b2" });
    const c = await insertMedia(env.DB, { ...BASE_ROW, external_id: "b3" });
    await insertCollection(env.DB, {
      id: "col:ac", name: "AC", parent_id: null, cover_url: null, sort_order: null,
    });

    const res = await patch("/api/media/bulk", {
      ids: [a.id, b.id],
      patch: { collection_id: "col:ac", status: "completed" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ updated: 2 });

    for (const id of [a.id, b.id]) {
      const row = (await findById(env.DB, id))!;
      expect(row.collection_id).toBe("col:ac");
      expect(row.status).toBe("completed");
      // Bulk "completed" fills progress to the total, just like the single-item
      // edit (BASE_ROW: total_episodes 26, current_episode null).
      expect(row.current_episode).toBe(26);
    }
    expect((await findById(env.DB, c.id))!.collection_id).toBeNull(); // untouched
  });

  it("fills progress to each row's own total on bulk completion (and leaves unknown totals alone)", async () => {
    const known = await insertMedia(env.DB, {
      ...BASE_ROW, external_id: "f1", total_episodes: 12, current_episode: 3,
    });
    const noTotal = await insertMedia(env.DB, {
      ...BASE_ROW, external_id: "f2", total_episodes: null, current_episode: 5,
    });
    const manga = await insertMedia(env.DB, {
      ...BASE_ROW, external_id: "f3", type: "manga", total_episodes: null,
      current_episode: null, total_chapters: 100, current_chapter: 40,
    });

    const res = await patch("/api/media/bulk", {
      ids: [known.id, noTotal.id, manga.id],
      patch: { status: "completed" },
    });
    expect(res.status).toBe(200);

    expect((await findById(env.DB, known.id))!.current_episode).toBe(12); // filled to its own total
    expect((await findById(env.DB, noTotal.id))!.current_episode).toBe(5); // unknown total → untouched
    expect((await findById(env.DB, manga.id))!.current_chapter).toBe(100); // chapter dimension fills too
  });

  it("does not fill progress for a non-completed bulk status", async () => {
    const a = await insertMedia(env.DB, {
      ...BASE_ROW, external_id: "f4", total_episodes: 26, current_episode: 4,
    });
    await patch("/api/media/bulk", { ids: [a.id], patch: { status: "paused" } });
    expect((await findById(env.DB, a.id))!.current_episode).toBe(4); // unchanged
  });

  it("clears progress on bulk move back to planned (keeps totals)", async () => {
    const ep = await insertMedia(env.DB, {
      ...BASE_ROW, external_id: "p1", total_episodes: 26, current_episode: 20,
    });
    const ch = await insertMedia(env.DB, {
      ...BASE_ROW, external_id: "p2", type: "manga", total_episodes: null,
      current_episode: null, total_chapters: 100, current_chapter: 55,
    });
    await patch("/api/media/bulk", { ids: [ep.id, ch.id], patch: { status: "planned" } });

    const epRow = (await findById(env.DB, ep.id))!;
    expect(epRow.status).toBe("planned");
    expect(epRow.current_episode).toBeNull(); // cleared
    expect(epRow.total_episodes).toBe(26); // total kept
    expect((await findById(env.DB, ch.id))!.current_chapter).toBeNull(); // chapter cleared too
  });

  it("400s on empty ids, empty patch, or a missing collection", async () => {
    const a = await insertMedia(env.DB, { ...BASE_ROW, external_id: "b4" });
    expect((await patch("/api/media/bulk", { ids: [], patch: { status: "completed" } })).status).toBe(400);
    expect((await patch("/api/media/bulk", { ids: [a.id], patch: {} })).status).toBe(400);
    expect(
      (await patch("/api/media/bulk", { ids: [a.id], patch: { collection_id: "col:ghost" } })).status,
    ).toBe(400);
  });
});

describe("DELETE /api/media/bulk", () => {
  const delBulk = (body: unknown) =>
    app.request(
      "/api/media/bulk",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );

  it("removes the selected rows, leaving the rest, and reports the count", async () => {
    const a = await insertMedia(env.DB, { ...BASE_ROW, external_id: "d1" });
    const b = await insertMedia(env.DB, { ...BASE_ROW, external_id: "d2" });
    const c = await insertMedia(env.DB, { ...BASE_ROW, external_id: "d3" });

    const res = await delBulk({ ids: [a.id, b.id] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: 2 });

    expect(await findById(env.DB, a.id)).toBeNull();
    expect(await findById(env.DB, b.id)).toBeNull();
    expect(await findById(env.DB, c.id)).not.toBeNull(); // untouched
  });

  it("counts only rows that existed (ignores already-gone ids)", async () => {
    const a = await insertMedia(env.DB, { ...BASE_ROW, external_id: "d4" });
    const res = await delBulk({ ids: [a.id, 999999] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: 1 });
  });

  it("400s on empty or non-integer ids", async () => {
    expect((await delBulk({ ids: [] })).status).toBe(400);
    expect((await delBulk({ ids: [1.5] })).status).toBe(400);
    expect((await delBulk({ ids: ["1"] })).status).toBe(400);
    expect((await delBulk({})).status).toBe(400);
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

  it("clears recorded progress when moved back to planned", async () => {
    const inserted = await insertMedia(env.DB, {
      ...BASE_ROW, total_episodes: 26, current_episode: 14,
    });
    const res = await patch(`/api/media/${inserted.id}`, { status: "planned" });
    const row = (await res.json()) as {
      status: string;
      current_episode: number | null;
      total_episodes: number | null;
    };
    expect(row.status).toBe("planned");
    expect(row.current_episode).toBeNull(); // progress cleared
    expect(row.total_episodes).toBe(26); // show metadata kept
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

// --- POST /api/media/:id/refresh-cover (TMDB origin-poster re-pull) ---------

async function refreshCover(id: number | string): Promise<Response> {
  return app.request(`/api/media/${id}/refresh-cover`, { method: "POST" }, env);
}

// A TMDB movie row already in the library (seeded directly — no R2 object yet).
const TMDB_MOVIE_ROW: AniListMapperResult = {
  ...BASE_ROW,
  type: "movie",
  external_source: "tmdb",
  external_id: "movie:496243",
  cover_url: "https://covers.zhanghanxue.com/covers/tmdb/movie_496243.jpg",
};

describe("POST /api/media/:id/refresh-cover", () => {
  it("re-pulls the TMDB poster, overwrites R2, and cache-busts the URL", async () => {
    mockTmdbMovieDetail();
    mockTmdbPoster();
    const inserted = await insertMedia(env.DB, TMDB_MOVIE_ROW);

    const res = await refreshCover(inserted.id);
    expect(res.status).toBe(200);
    const row = (await res.json()) as Record<string, unknown>;

    const cover = row.cover_url as string;
    expect(cover).toContain(
      "https://covers.zhanghanxue.com/covers/tmdb/movie_496243.jpg",
    );
    expect(cover).toMatch(/[?&]v=\d+$/); // cache-busted so the browser refetches
    const head = await env.COVERS.head("covers/tmdb/movie_496243.jpg");
    expect(head).not.toBeNull();
  });

  it("returns 422 for a non-TMDB item (nothing to refresh)", async () => {
    const inserted = await insertMedia(env.DB, BASE_ROW); // anilist
    const res = await refreshCover(inserted.id);
    expect(res.status).toBe(422);
  });

  it("returns 404 for a missing id", async () => {
    const res = await refreshCover(999999);
    expect(res.status).toBe(404);
  });

  it("returns 422 when the external_id isn't a parseable TMDB ref", async () => {
    const inserted = await insertMedia(env.DB, {
      ...TMDB_MOVIE_ROW,
      external_id: "garbage",
    });
    const res = await refreshCover(inserted.id);
    expect(res.status).toBe(422);
  });

  it("returns 404 when TMDB no longer has the id", async () => {
    fetchMock
      .get(TMDB_API_ORIGIN)
      .intercept({ method: "GET", path: /^\/3\/movie\/999999999/ })
      .reply(404, JSON.stringify({ status_code: 34 }), {
        headers: { "content-type": "application/json" },
      });
    const inserted = await insertMedia(env.DB, {
      ...TMDB_MOVIE_ROW,
      external_id: "movie:999999999",
    });
    const res = await refreshCover(inserted.id);
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await refreshCover("abc");
    expect(res.status).toBe(400);
  });
});

// --- Video parts (media_video_parts) ---------------------------------------

describe("video parts (/api/media/:id/parts)", () => {
  async function addPart(id: number, body: unknown): Promise<Response> {
    return app.request(
      `/api/media/${id}/parts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );
  }
  const listParts = (id: number | string) =>
    app.request(`/api/media/${id}/parts`, {}, env);

  it("appends parts with auto-incrementing part_number and lists them ordered", async () => {
    const m = await insertMedia(env.DB, BASE_ROW);

    const a = await addPart(m.id, { url: "https://yt/1", title: "Part one" });
    expect(a.status).toBe(201);
    expect((await a.json()) as { part_number: number }).toMatchObject({
      part_number: 1,
      title: "Part one",
      url: "https://yt/1",
    });

    const b = await addPart(m.id, { url: "https://yt/2" }); // no title
    expect((await b.json()) as { part_number: number }).toMatchObject({
      part_number: 2,
      title: null,
    });

    const list = (await (await listParts(m.id)).json()) as {
      parts: Array<{ part_number: number; url: string }>;
    };
    expect(list.parts.map((p) => p.part_number)).toEqual([1, 2]);
  });

  it("edits a part's url and title (PATCH)", async () => {
    const m = await insertMedia(env.DB, BASE_ROW);
    const created = (await (await addPart(m.id, { url: "https://yt/old", title: "Old" })).json()) as {
      id: number;
      part_number: number;
    };

    const res = await app.request(
      `/api/media/${m.id}/parts/${created.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://yt/new", title: "New" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({
      id: created.id,
      part_number: created.part_number, // unchanged
      url: "https://yt/new",
      title: "New",
    });
  });

  it("clears a part's title when edited to blank, and 400s on a blank url", async () => {
    const m = await insertMedia(env.DB, BASE_ROW);
    const created = (await (await addPart(m.id, { url: "https://yt/x", title: "T" })).json()) as {
      id: number;
    };
    const patch = (body: unknown) =>
      app.request(
        `/api/media/${m.id}/parts/${created.id}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        env,
      );

    const cleared = await patch({ url: "https://yt/x", title: "  " });
    expect(((await cleared.json()) as { title: string | null }).title).toBeNull();
    expect((await patch({ url: "  " })).status).toBe(400);
  });

  it("404s editing a part that doesn't exist", async () => {
    const m = await insertMedia(env.DB, BASE_ROW);
    const res = await app.request(
      `/api/media/${m.id}/parts/99999`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://yt/z" }) },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("deletes a part (and cascades when the media is deleted)", async () => {
    const m = await insertMedia(env.DB, BASE_ROW);
    const created = (await (await addPart(m.id, { url: "https://yt/x" })).json()) as {
      id: number;
    };

    const delRes = await app.request(
      `/api/media/${m.id}/parts/${created.id}`,
      { method: "DELETE" },
      env,
    );
    expect(delRes.status).toBe(204);
    const list = (await (await listParts(m.id)).json()) as { parts: unknown[] };
    expect(list.parts).toHaveLength(0);
  });

  it("400s on a blank url", async () => {
    const m = await insertMedia(env.DB, BASE_ROW);
    expect((await addPart(m.id, { url: "   " })).status).toBe(400);
  });

  it("404s when adding to a missing media", async () => {
    expect((await addPart(999999, { url: "https://yt/1" })).status).toBe(404);
  });

  it("404s when deleting a non-existent part", async () => {
    const m = await insertMedia(env.DB, BASE_ROW);
    const res = await app.request(
      `/api/media/${m.id}/parts/999999`,
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(404);
  });
});

// --- POST /api/media/:id/refresh-episodes (ongoing episode-count refresh) ----

async function refreshEpisodes(
  id: number | string,
  body?: unknown,
): Promise<Response> {
  return app.request(
    `/api/media/${id}/refresh-episodes`,
    {
      method: "POST",
      ...(body !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    },
    env,
  );
}

describe("POST /api/media/:id/refresh-episodes", () => {
  it("sets total_episodes from a browser-supplied count (AniList path) without bumping date_updated", async () => {
    const inserted = await insertMedia(env.DB, { ...BASE_ROW, total_episodes: 26 });

    const res = await refreshEpisodes(inserted.id, { total_episodes: 1163 });
    expect(res.status).toBe(200);
    const row = (await res.json()) as Record<string, unknown>;
    expect(row.total_episodes).toBe(1163);
    // No date bump — a bulk refresh shouldn't reorder a date-sorted list.
    expect(row.date_updated).toBe(inserted.date_updated);
  });

  it("fetches the count from TMDB for a tv row with no body", async () => {
    fetchMock
      .get(TMDB_API_ORIGIN)
      .intercept({ method: "GET", path: /^\/3\/tv\/211089/ })
      .reply(200, JSON.stringify({ id: 211089, number_of_episodes: 36 }), {
        headers: { "content-type": "application/json" },
      });
    const inserted = await insertMedia(env.DB, {
      ...BASE_ROW,
      type: "drama",
      external_source: "tmdb",
      external_id: "tv:211089",
    });

    const res = await refreshEpisodes(inserted.id);
    expect(res.status).toBe(200);
    const row = (await res.json()) as Record<string, unknown>;
    expect(row.total_episodes).toBe(36);
  });

  it("422s for a TMDB movie (no episode count to refresh)", async () => {
    const inserted = await insertMedia(env.DB, {
      ...BASE_ROW,
      type: "movie",
      external_source: "tmdb",
      external_id: "movie:603",
    });
    const res = await refreshEpisodes(inserted.id);
    expect(res.status).toBe(422);
  });

  it("422s for a non-TMDB row with no body", async () => {
    const inserted = await insertMedia(env.DB, {
      ...BASE_ROW,
      external_source: "bangumi",
      external_id: "12345",
    });
    const res = await refreshEpisodes(inserted.id);
    expect(res.status).toBe(422);
  });

  it("400s on a negative total_episodes", async () => {
    const inserted = await insertMedia(env.DB, BASE_ROW);
    const res = await refreshEpisodes(inserted.id, { total_episodes: -3 });
    expect(res.status).toBe(400);
  });

  it("404s for a missing id", async () => {
    const res = await refreshEpisodes(999999, { total_episodes: 5 });
    expect(res.status).toBe(404);
  });
});
