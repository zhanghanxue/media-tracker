import { describe, expect, it } from "vitest";

import { bangumiCover, bangumiTypeFor } from "./bangumiSearch";
import type { BangumiSubject } from "../../worker/sources/bangumi";

describe("bangumiTypeFor", () => {
  it("maps manga and light_novel to book (type 1)", () => {
    expect(bangumiTypeFor("manga")).toBe(1);
    expect(bangumiTypeFor("light_novel")).toBe(1);
  });

  it("maps everything else to anime (type 2)", () => {
    expect(bangumiTypeFor("animation")).toBe(2);
    expect(bangumiTypeFor("movie")).toBe(2);
    expect(bangumiTypeFor("game")).toBe(2);
  });
});

describe("bangumiCover", () => {
  const base: BangumiSubject = { id: 1, type: 2, name: "x", name_cn: "x", images: null };

  it("upgrades legacy http://lain.bgm.tv URLs to https (avoid mixed content)", () => {
    const s: BangumiSubject = {
      ...base,
      images: {
        large: "http://lain.bgm.tv/pic/cover/l/x.jpg",
        common: null,
        medium: null,
        small: null,
        grid: null,
      },
    };
    expect(bangumiCover(s)).toBe("https://lain.bgm.tv/pic/cover/l/x.jpg");
  });

  it("falls back to the v0 `image` field when `images` is absent", () => {
    expect(bangumiCover({ ...base, image: "https://lain.bgm.tv/r/200/x.jpg" })).toBe(
      "https://lain.bgm.tv/r/200/x.jpg",
    );
  });

  it("returns null when there's no cover at all", () => {
    expect(bangumiCover(base)).toBeNull();
  });
});
