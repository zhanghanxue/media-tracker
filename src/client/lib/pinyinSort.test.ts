import { describe, expect, it } from "vitest";

import { loadPinyin, pinyinKey, resolveTitleSort, zhSortTitle } from "./pinyinSort";
import type { MediaRow } from "./types";

describe("resolveTitleSort", () => {
  it("maps the title options to the pinyin-keyed title_zh in a zh UI", () => {
    expect(resolveTitleSort("title", "zh")).toBe("title_zh");
    expect(resolveTitleSort("title_desc", "zh")).toBe("title_zh_desc");
  });

  it("leaves the title options English-first in an en UI", () => {
    expect(resolveTitleSort("title", "en")).toBe("title");
    expect(resolveTitleSort("title_desc", "en")).toBe("title_desc");
  });

  it("passes non-title sorts through unchanged (both languages)", () => {
    expect(resolveTitleSort("date_updated", "zh")).toBe("date_updated");
    expect(resolveTitleSort("rating_desc", "zh")).toBe("rating_desc");
    expect(resolveTitleSort("status", "en")).toBe("status");
  });
});

describe("zhSortTitle", () => {
  it("prefers chinese > native > english > romaji (mirrors the worker + server)", () => {
    const item = (o: Partial<MediaRow>) => o as MediaRow;
    expect(
      zhSortTitle(item({ title_chinese: "火影忍者", title_english: "Naruto" })),
    ).toBe("火影忍者");
    expect(
      zhSortTitle(item({ title_native: "進撃の巨人", title_english: "AoT" })),
    ).toBe("進撃の巨人");
    expect(zhSortTitle(item({ title_english: "Bleach" }))).toBe("Bleach");
  });
});

describe("pinyinKey (after loading pinyin-pro)", () => {
  it("matches the worker transform: CJK → toneless lowercase pinyin, pinyin order", async () => {
    await loadPinyin();
    // Same expected strings as the worker's toPinyinKey test — if the two
    // transforms ever diverge, the collection interleave would mis-slot cards.
    expect(pinyinKey("火影忍者")).toBe("huo ying ren zhe");
    expect(pinyinKey("死神")).toBe("si shen");
    expect(pinyinKey("火影忍者") < pinyinKey("死神")).toBe(true);
  });
});
