import { describe, expect, it } from "vitest";

import {
  titleSortZh,
  toPinyinKey,
  withTitleSortKey,
  zhSortTitle,
} from "./titleSortKey";
import type { MediaRow } from "../db/schema";

describe("toPinyinKey", () => {
  it("romanizes CJK to toneless lowercase pinyin", () => {
    expect(toPinyinKey("火影忍者")).toBe("huo ying ren zhe");
    expect(toPinyinKey("死神")).toBe("si shen");
  });

  it("orders CJK by PINYIN, not code point (the whole point)", () => {
    // Code point: 火 (U+706B) > 死 (U+6B7B), so raw SQLite would put 死神 first.
    // Pinyin: huo < si, so 火影忍者 must sort BEFORE 死神.
    expect(toPinyinKey("火影忍者") < toPinyinKey("死神")).toBe(true);
  });

  it("keeps non-Chinese runs and lowercases", () => {
    expect(toPinyinKey("Bleach S2")).toBe("bleach s2");
  });

  it("returns '' for empty input", () => {
    expect(toPinyinKey("")).toBe("");
  });
});

describe("zhSortTitle", () => {
  it("prefers chinese > native > english > romaji (the title_zh COALESCE)", () => {
    expect(
      zhSortTitle({
        title_chinese: "火影忍者",
        title_native: "NARUTO",
        title_english: "Naruto",
        title_romaji: "Naruto",
      }),
    ).toBe("火影忍者");
    expect(
      zhSortTitle({
        title_chinese: null,
        title_native: "進撃の巨人",
        title_english: "Attack on Titan",
        title_romaji: null,
      }),
    ).toBe("進撃の巨人");
    expect(
      zhSortTitle({
        title_chinese: null,
        title_native: null,
        title_english: "Bleach",
        title_romaji: "BLEACH",
      }),
    ).toBe("Bleach");
  });
});

describe("titleSortZh", () => {
  it("is the pinyin of the zh-display title", () => {
    expect(
      titleSortZh({
        title_chinese: "火影忍者",
        title_native: null,
        title_english: "Naruto",
        title_romaji: null,
      }),
    ).toBe("huo ying ren zhe");
  });
});

function row(over: Partial<MediaRow>): MediaRow {
  return { id: 1, title_sort_zh: null, ...over } as MediaRow;
}

describe("withTitleSortKey", () => {
  it("adds a recomputed key when the patch changes a title", () => {
    const existing = row({ title_chinese: "死神", title_english: "Bleach" });
    const out = withTitleSortKey(existing, { title_chinese: "火影忍者" });
    expect(out.title_sort_zh).toBe("huo ying ren zhe"); // from the NEW title
  });

  it("computes from the MERGED row (existing overlaid with the patch)", () => {
    // Patch only clears the Chinese title → key falls back to the existing english.
    const existing = row({ title_chinese: "死神", title_english: "Bleach" });
    const out = withTitleSortKey(existing, { title_chinese: null });
    expect(out.title_sort_zh).toBe("bleach");
  });

  it("is a no-op when the patch touches no title field", () => {
    const existing = row({ title_chinese: "死神" });
    const patch = { status: "completed" as const };
    expect(withTitleSortKey(existing, patch)).toBe(patch); // same object, unchanged
    expect("title_sort_zh" in withTitleSortKey(existing, patch)).toBe(false);
  });
});
