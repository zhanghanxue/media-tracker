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

  it("collects all errors at once", () => {
    const result = parseCreateMediaRequest({
      external_source: "mal",
      status: "banana",
      media: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // bad source + bad status + 3 media-shape errors (id, title, coverImage)
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    }
  });
});
