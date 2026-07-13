import { describe, expect, it } from "vitest";

import { pickHanAlias } from "./igdb-alias";

describe("pickHanAlias", () => {
  it("picks a Chinese alternative name", () => {
    expect(pickHanAlias(["Wandering Sword", "逸剑风云决"])).toBe("逸剑风云决");
  });

  it("rejects Japanese titles (kana present)", () => {
    expect(pickHanAlias(["飢えた子羊", "Hungry Lamb"])).toBeNull();
  });

  it("accepts kanji-only Chinese even alongside a Japanese variant", () => {
    expect(pickHanAlias(["飢えた子羊", "饿殍：明末千里行"])).toBe(
      "饿殍：明末千里行",
    );
  });

  it("prefers the shortest (bare) name over a descriptive variant", () => {
    expect(
      pickHanAlias(["逸剑风云决 (中日英韩文版) - 完全版", "逸剑风云决"]),
    ).toBe("逸剑风云决");
  });

  it("requires at least 2 Han ideographs", () => {
    expect(pickHanAlias(["剑 Sword Remix Edition"])).toBeNull();
  });

  it("returns null for empty / null-ish input", () => {
    expect(pickHanAlias([])).toBeNull();
    expect(pickHanAlias([null, undefined, "  "])).toBeNull();
  });
});
