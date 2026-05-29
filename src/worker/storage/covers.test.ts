import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadCoverToR2, type CoverEnv } from "./covers";

const PUBLIC_BASE = "https://covers.zhanghanxue.com";
const ANILIST_COVER =
  "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101922-WBsBl0ClmgYL.jpg";
const KIMETSU_KEY = { externalSource: "anilist", externalId: "101922" };

// Minimal R2Bucket stub: only head + put are called by uploadCoverToR2.
// We cast to R2Bucket since we don't need the full surface for these tests.
function makeR2(): {
  head: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
} {
  return {
    head: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue({}),
  };
}

function makeEnv(r2: ReturnType<typeof makeR2>): CoverEnv {
  return {
    COVERS: r2 as unknown as R2Bucket,
    COVERS_PUBLIC_URL_BASE: PUBLIC_BASE,
  };
}

function makeImageResponse(
  contentType = "image/jpeg",
  bytes: ArrayBuffer = new ArrayBuffer(8),
): Response {
  return new Response(bytes, {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

describe("uploadCoverToR2 — happy path", () => {
  let r2: ReturnType<typeof makeR2>;
  let env: CoverEnv;

  beforeEach(() => {
    r2 = makeR2();
    env = makeEnv(r2);
  });

  it("returns a URL under COVERS_PUBLIC_URL_BASE with the right object key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeImageResponse());

    const url = await uploadCoverToR2(env, ANILIST_COVER, KIMETSU_KEY, {
      fetch: fetchMock,
    });

    expect(url).toBe(`${PUBLIC_BASE}/covers/anilist/101922.jpg`);
  });

  it("puts the bytes to R2 under covers/{source}/{id}.{ext} with the upstream Content-Type", async () => {
    const bytes = new TextEncoder().encode("fake-image-bytes").buffer;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeImageResponse("image/jpeg", bytes));

    await uploadCoverToR2(env, ANILIST_COVER, KIMETSU_KEY, {
      fetch: fetchMock,
    });

    expect(r2.put).toHaveBeenCalledTimes(1);
    const [putKey, putValue, putOptions] = r2.put.mock.calls[0]!;
    expect(putKey).toBe("covers/anilist/101922.jpg");
    expect(putValue).toBeInstanceOf(ArrayBuffer);
    expect((putValue as ArrayBuffer).byteLength).toBe(bytes.byteLength);
    expect(putOptions.httpMetadata.contentType).toBe("image/jpeg");
  });

  it("checks R2 with head() before fetching upstream (idempotency probe)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeImageResponse());

    await uploadCoverToR2(env, ANILIST_COVER, KIMETSU_KEY, {
      fetch: fetchMock,
    });

    expect(r2.head).toHaveBeenCalledWith("covers/anilist/101922.jpg");
    // head() should have happened before fetch() — head returns null then we fetch.
    expect(r2.head).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to image/jpeg when the response has no Content-Type", async () => {
    const noTypeResponse = new Response(new ArrayBuffer(8), { status: 200 });
    // Force Content-Type to be absent by stripping it.
    noTypeResponse.headers.delete("content-type");
    const fetchMock = vi.fn().mockResolvedValue(noTypeResponse);

    await uploadCoverToR2(env, ANILIST_COVER, KIMETSU_KEY, {
      fetch: fetchMock,
    });

    const [, , putOptions] = r2.put.mock.calls[0]!;
    expect(putOptions.httpMetadata.contentType).toBe("image/jpeg");
  });
});

describe("uploadCoverToR2 — idempotency", () => {
  it("skips fetch + put when the object already exists in R2", async () => {
    const r2 = makeR2();
    // head() returns a non-null R2Object → object is already uploaded.
    r2.head.mockResolvedValue({ key: "covers/anilist/101922.jpg" });

    const fetchMock = vi.fn();
    const url = await uploadCoverToR2(
      makeEnv(r2),
      ANILIST_COVER,
      KIMETSU_KEY,
      { fetch: fetchMock },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(r2.put).not.toHaveBeenCalled();
    expect(url).toBe(`${PUBLIC_BASE}/covers/anilist/101922.jpg`);
  });
});

describe("uploadCoverToR2 — overwrite (cover refresh)", () => {
  it("re-fetches and re-puts even when the object already exists", async () => {
    const r2 = makeR2();
    // Object already in R2 — the default path would short-circuit here.
    r2.head.mockResolvedValue({ key: "covers/tmdb/movie_603.jpg" });
    const fetchMock = vi.fn().mockResolvedValue(makeImageResponse());

    const url = await uploadCoverToR2(
      makeEnv(r2),
      "https://image.tmdb.org/t/p/w500/new.jpg",
      { externalSource: "tmdb", externalId: "movie:603" },
      { fetch: fetchMock, overwrite: true },
    );

    // With overwrite we skip the head() short-circuit and replace the bytes.
    expect(r2.head).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r2.put).toHaveBeenCalledTimes(1);
    expect(url).toBe(`${PUBLIC_BASE}/covers/tmdb/movie_603.jpg`);
  });
});

describe("uploadCoverToR2 — graceful fallback on upstream failure", () => {
  it("returns the upstream URL when fetch resolves with a 404", async () => {
    const r2 = makeR2();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("not found", { status: 404 }));

    const url = await uploadCoverToR2(
      makeEnv(r2),
      ANILIST_COVER,
      KIMETSU_KEY,
      { fetch: fetchMock },
    );

    expect(url).toBe(ANILIST_COVER);
    expect(r2.put).not.toHaveBeenCalled();
  });

  it("returns the upstream URL when fetch resolves with a 500", async () => {
    const r2 = makeR2();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("server error", { status: 500 }));

    const url = await uploadCoverToR2(
      makeEnv(r2),
      ANILIST_COVER,
      KIMETSU_KEY,
      { fetch: fetchMock },
    );

    expect(url).toBe(ANILIST_COVER);
    expect(r2.put).not.toHaveBeenCalled();
  });

  it("returns the upstream URL when fetch rejects (network error)", async () => {
    const r2 = makeR2();
    const fetchMock = vi.fn().mockRejectedValue(new Error("DNS failure"));

    const url = await uploadCoverToR2(
      makeEnv(r2),
      ANILIST_COVER,
      KIMETSU_KEY,
      { fetch: fetchMock },
    );

    expect(url).toBe(ANILIST_COVER);
    expect(r2.put).not.toHaveBeenCalled();
  });
});

describe("uploadCoverToR2 — extension inference from source URL", () => {
  it("uses .png for a .png source", async () => {
    const r2 = makeR2();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeImageResponse("image/png"));

    const url = await uploadCoverToR2(
      makeEnv(r2),
      "https://s4.anilist.co/file/.../bx112151-1qlQwPB1RrJe.png",
      KIMETSU_KEY,
      { fetch: fetchMock },
    );

    expect(url.endsWith(".png")).toBe(true);
    expect(r2.put.mock.calls[0]![0]).toBe("covers/anilist/101922.png");
  });

  it("uses .webp for a .webp source", async () => {
    const r2 = makeR2();
    const fetchMock = vi.fn().mockResolvedValue(makeImageResponse("image/webp"));

    const url = await uploadCoverToR2(
      makeEnv(r2),
      "https://example.com/cover.webp",
      KIMETSU_KEY,
      { fetch: fetchMock },
    );

    expect(url.endsWith(".webp")).toBe(true);
  });

  it("strips query string before extracting extension", async () => {
    const r2 = makeR2();
    const fetchMock = vi.fn().mockResolvedValue(makeImageResponse());

    const url = await uploadCoverToR2(
      makeEnv(r2),
      "https://example.com/cover.jpg?cache=12345&v=2",
      KIMETSU_KEY,
      { fetch: fetchMock },
    );

    expect(url.endsWith(".jpg")).toBe(true);
    expect(r2.put.mock.calls[0]![0]).toBe("covers/anilist/101922.jpg");
  });

  it("falls back to .jpg when the URL has no recognizable image extension", async () => {
    const r2 = makeR2();
    const fetchMock = vi.fn().mockResolvedValue(makeImageResponse());

    const url = await uploadCoverToR2(
      makeEnv(r2),
      "https://example.com/cover.php?id=42",
      KIMETSU_KEY,
      { fetch: fetchMock },
    );

    expect(url.endsWith(".jpg")).toBe(true);
    expect(r2.put.mock.calls[0]![0]).toBe("covers/anilist/101922.jpg");
  });

  it("falls back to .jpg when the URL has no extension at all", async () => {
    const r2 = makeR2();
    const fetchMock = vi.fn().mockResolvedValue(makeImageResponse());

    await uploadCoverToR2(
      makeEnv(r2),
      "https://example.com/cover",
      KIMETSU_KEY,
      { fetch: fetchMock },
    );

    expect(r2.put.mock.calls[0]![0]).toBe("covers/anilist/101922.jpg");
  });
});

describe("uploadCoverToR2 — public URL formatting", () => {
  it("strips a trailing slash from COVERS_PUBLIC_URL_BASE before joining the key", async () => {
    const r2 = makeR2();
    const env: CoverEnv = {
      COVERS: r2 as unknown as R2Bucket,
      COVERS_PUBLIC_URL_BASE: "https://covers.zhanghanxue.com/",
    };
    const fetchMock = vi.fn().mockResolvedValue(makeImageResponse());

    const url = await uploadCoverToR2(env, ANILIST_COVER, KIMETSU_KEY, {
      fetch: fetchMock,
    });

    // No double slash between the base and the key.
    expect(url).toBe("https://covers.zhanghanxue.com/covers/anilist/101922.jpg");
  });
});
