import { describe, expect, it } from "vitest";

import { parseCreateMediaRequest } from "./validation";

// A representative AniList media object (what the browser POSTs).
const MEDIA = {
  id: 101922,
  title: { romaji: "Kimetsu no Yaiba", english: "Demon Slayer", native: "鬼滅の刃" },
  coverImage: { extraLarge: "https://s4.anilist.co/x.jpg" },
  format: "TV",
  episodes: 26,
  chapters: null,
  volumes: null,
  season: "SPRING",
  seasonYear: 2019,
  countryOfOrigin: "JP",
};

const VALID = {
  external_source: "anilist",
  status: "planned",
  media: MEDIA,
};

describe("parseCreateMediaRequest — accepts valid input", () => {
  it("returns ok with source, status, and the media object", () => {
    const result = parseCreateMediaRequest(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.external_source).toBe("anilist");
      expect(result.value.status).toBe("planned");
      expect(result.value.media.id).toBe(101922);
    }
  });
});

describe("parseCreateMediaRequest — rejects invalid input", () => {
  it("rejects a non-object body", () => {
    expect(parseCreateMediaRequest("nope").ok).toBe(false);
  });

  it("rejects an unknown external_source", () => {
    const result = parseCreateMediaRequest({ ...VALID, external_source: "mal" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("external_source"))).toBe(
        true,
      );
    }
  });

  it("rejects an invalid status", () => {
    const result = parseCreateMediaRequest({ ...VALID, status: "banana" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("status"))).toBe(true);
    }
  });

  it("rejects a missing media object", () => {
    const { media: _omit, ...withoutMedia } = VALID;
    const result = parseCreateMediaRequest(withoutMedia);
    expect(result.ok).toBe(false);
  });

  it("rejects media with a non-positive-integer id", () => {
    expect(
      parseCreateMediaRequest({ ...VALID, media: { ...MEDIA, id: 0 } }).ok,
    ).toBe(false);
    expect(
      parseCreateMediaRequest({ ...VALID, media: { ...MEDIA, id: "x" } }).ok,
    ).toBe(false);
  });

  it("rejects media missing the title object", () => {
    const { title: _omit, ...mediaNoTitle } = MEDIA;
    const result = parseCreateMediaRequest({ ...VALID, media: mediaNoTitle });
    expect(result.ok).toBe(false);
  });

  it("collects all errors at once (doesn't short-circuit)", () => {
    // Valid source so the AniList shape checks run; everything else is broken.
    const result = parseCreateMediaRequest({
      external_source: "anilist",
      status: "banana",
      media: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // bad status + 3 AniList media-shape errors (id, title, coverImage)
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    }
  });
});

// A representative Bangumi subject (what the browser POSTs for a direct add).
const BGM_MEDIA = {
  id: 245665,
  type: 2,
  name: "鬼滅の刃",
  name_cn: "鬼灭之刃",
  platform: "TV",
  eps: 26,
  total_episodes: 26,
  images: { large: "https://lain.bgm.tv/x.jpg" },
};

const VALID_BGM = {
  external_source: "bangumi",
  status: "planned",
  media: BGM_MEDIA,
};

describe("parseCreateMediaRequest — Bangumi source", () => {
  it("accepts a valid Bangumi subject (name + type, not the AniList shape)", () => {
    const result = parseCreateMediaRequest(VALID_BGM);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.external_source).toBe("bangumi");
      expect(result.value.media.id).toBe(245665);
    }
  });

  it("does NOT require the AniList title/coverImage objects for a Bangumi body", () => {
    // Bangumi media legitimately has no `title`/`coverImage` keys.
    const result = parseCreateMediaRequest(VALID_BGM);
    expect(result.ok).toBe(true);
  });

  it("rejects a Bangumi subject missing the name", () => {
    const { name: _omit, ...noName } = BGM_MEDIA;
    const result = parseCreateMediaRequest({ ...VALID_BGM, media: noName });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("media.name"))).toBe(true);
    }
  });

  it("rejects a Bangumi subject with a non-numeric type", () => {
    const result = parseCreateMediaRequest({
      ...VALID_BGM,
      media: { ...BGM_MEDIA, type: "anime" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("media.type"))).toBe(true);
    }
  });
});

describe("parseCreateMediaRequest — IGDB source", () => {
  const VALID_IGDB = {
    external_source: "igdb",
    status: "in_progress",
    media: { id: 1942, consumption_mode: "playing", platform: "pc" },
  };

  it("accepts a valid IGDB ref (id + consumption_mode + platform)", () => {
    const result = parseCreateMediaRequest(VALID_IGDB);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.external_source).toBe("igdb");
      expect(result.value.media.id).toBe(1942);
    }
  });

  it("accepts a null platform", () => {
    const result = parseCreateMediaRequest({
      ...VALID_IGDB,
      media: { id: 1, consumption_mode: "watching", platform: null },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a missing / bad consumption_mode", () => {
    const result = parseCreateMediaRequest({
      ...VALID_IGDB,
      media: { id: 1, consumption_mode: "banana", platform: null },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.startsWith("media.consumption_mode")),
      ).toBe(true);
    }
  });

  it("rejects an unknown platform bucket", () => {
    const result = parseCreateMediaRequest({
      ...VALID_IGDB,
      media: { id: 1, consumption_mode: "playing", platform: "switch" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("media.platform"))).toBe(
        true,
      );
    }
  });
});
