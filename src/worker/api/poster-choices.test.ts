import { describe, expect, it } from "vitest";

import {
  isTmdbPosterPath,
  MAX_POSTER_CHOICES,
  selectPosterChoices,
} from "./poster-choices";
import type { TmdbImage } from "../sources/tmdb";

const poster = (over: Partial<TmdbImage>): TmdbImage =>
  ({ file_path: "/abc.jpg", iso_639_1: "en", vote_average: 5, ...over }) as TmdbImage;

describe("isTmdbPosterPath", () => {
  it("accepts a real TMDB poster path", () => {
    expect(isTmdbPosterPath("/wJVfG0J3mavCcDar2Jwnba96ohN.jpg")).toBe(true);
    expect(isTmdbPosterPath("/a_b-c.png")).toBe(true);
    expect(isTmdbPosterPath("/x.WEBP")).toBe(true);
  });

  it("rejects anything that could point somewhere else", () => {
    // The setter builds its URL from this, so it must not accept a host,
    // a scheme, or a traversal.
    expect(isTmdbPosterPath("https://evil.example/a.jpg")).toBe(false);
    expect(isTmdbPosterPath("//evil.example/a.jpg")).toBe(false);
    expect(isTmdbPosterPath("/../../etc/passwd")).toBe(false);
    expect(isTmdbPosterPath("/a/b.jpg")).toBe(false);
    expect(isTmdbPosterPath("abc.jpg")).toBe(false);
    expect(isTmdbPosterPath("/abc.svg")).toBe(false);
    expect(isTmdbPosterPath("/abc")).toBe(false);
    expect(isTmdbPosterPath("")).toBe(false);
  });
});

describe("selectPosterChoices", () => {
  it("orders by vote average, best first", () => {
    const out = selectPosterChoices([
      poster({ file_path: "/low.jpg", vote_average: 1 }),
      poster({ file_path: "/high.jpg", vote_average: 9 }),
      poster({ file_path: "/mid.jpg", vote_average: 5 }),
    ]);
    expect(out.map((p) => p.path)).toEqual(["/high.jpg", "/mid.jpg", "/low.jpg"]);
  });

  it("does NOT rank by language", () => {
    // Opening the picker means the automatic origin-language pick was wrong,
    // so re-sorting by language would bury the alternatives.
    const out = selectPosterChoices([
      poster({ file_path: "/en.jpg", iso_639_1: "en", vote_average: 9 }),
      poster({ file_path: "/ja.jpg", iso_639_1: "ja", vote_average: 2 }),
    ]);
    expect(out[0]!.path).toBe("/en.jpg");
  });

  it("keeps textless art, tagged as such", () => {
    const out = selectPosterChoices([
      poster({ file_path: "/none.jpg", iso_639_1: null }),
    ]);
    expect(out).toEqual([{ path: "/none.jpg", language: null, voteAverage: 5 }]);
  });

  it("treats a missing vote as zero rather than dropping the poster", () => {
    const out = selectPosterChoices([
      poster({ file_path: "/unvoted.jpg", vote_average: undefined }),
    ]);
    expect(out).toEqual([
      { path: "/unvoted.jpg", language: "en", voteAverage: 0 },
    ]);
  });

  it("drops malformed paths so the UI can't offer what the setter rejects", () => {
    const out = selectPosterChoices([
      poster({ file_path: "/ok.jpg" }),
      poster({ file_path: "https://evil.example/a.jpg" }),
      poster({ file_path: undefined as unknown as string }),
    ]);
    expect(out.map((p) => p.path)).toEqual(["/ok.jpg"]);
  });

  it("caps the grid", () => {
    const many = Array.from({ length: MAX_POSTER_CHOICES + 10 }, (_, i) =>
      poster({ file_path: `/p${i}.jpg`, vote_average: i }),
    );
    expect(selectPosterChoices(many)).toHaveLength(MAX_POSTER_CHOICES);
  });

  it("handles no posters at all", () => {
    expect(selectPosterChoices(undefined)).toEqual([]);
    expect(selectPosterChoices([])).toEqual([]);
  });
});
