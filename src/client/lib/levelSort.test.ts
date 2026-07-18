import { describe, expect, it } from "vitest";

import { compareTitleKeys, levelTitleKey } from "./levelSort";
import type { MediaRow } from "./types";

function row(fields: Partial<MediaRow>): MediaRow {
  return {
    title_english: null,
    title_romaji: null,
    title_native: null,
    title_chinese: null,
    ...fields,
  } as MediaRow;
}

describe("levelTitleKey", () => {
  it("mirrors the server COALESCE precedence: english > romaji > native > chinese", () => {
    expect(
      levelTitleKey(
        row({
          title_english: "Attack on Titan",
          title_romaji: "Shingeki no Kyojin",
          title_native: "進撃の巨人",
          title_chinese: "进击的巨人",
        }),
      ),
    ).toBe("attack on titan");
    expect(
      levelTitleKey(
        row({ title_romaji: "Shingeki no Kyojin", title_native: "進撃の巨人" }),
      ),
    ).toBe("shingeki no kyojin");
    expect(levelTitleKey(row({ title_native: "進撃の巨人" }))).toBe("進撃の巨人");
    expect(levelTitleKey(row({ title_chinese: "进击的巨人" }))).toBe("进击的巨人");
  });

  it("lowercases to mirror COLLATE NOCASE", () => {
    expect(levelTitleKey(row({ title_english: "BLEACH" }))).toBe("bleach");
  });

  it("returns '' for a row with no title (sorts first, like COALESCE(...)='')", () => {
    expect(levelTitleKey(row({}))).toBe("");
  });
});

describe("compareTitleKeys", () => {
  it("is case-insensitive via the pre-lowercased keys", () => {
    // Keys arrive lowercased from levelTitleKey, so "apple" vs "banana".
    expect(compareTitleKeys("apple", "banana")).toBeLessThan(0);
    expect(compareTitleKeys("banana", "apple")).toBeGreaterThan(0);
    expect(compareTitleKeys("apple", "apple")).toBe(0);
  });

  it("orders NON-numerically, matching the server (NOT Intl numeric collation)", () => {
    // The regression: SQLite COLLATE NOCASE compares "part 1(0)" vs "part 2" at
    // the char after "part ", so "part 10" < "part 2". The old client comparator
    // used Intl.Collator({numeric:true}), which sorts "part 2" < "part 10" and
    // therefore disagreed with the server's pagination order.
    expect(compareTitleKeys("part 10", "part 2")).toBeLessThan(0);
  });
});

describe("sorting items by (levelTitleKey + compareTitleKeys)", () => {
  it("reproduces the server's title ORDER BY, including the numeric case", () => {
    const items = [
      row({ title_english: "Part 2" }),
      row({ title_english: "part 10" }),
      row({ title_english: "Bleach" }),
      row({ title_romaji: "Akira" }), // english null → falls back to romaji
    ];
    const ordered = [...items]
      .sort((a, b) => compareTitleKeys(levelTitleKey(a), levelTitleKey(b)))
      .map(levelTitleKey);
    // Code-point NOCASE order: akira, bleach, part 10, part 2.
    expect(ordered).toEqual(["akira", "bleach", "part 10", "part 2"]);
  });

  it("is a STABLE no-op on data already in server order (no cross-page reshuffle)", () => {
    // Given items already in server order, re-sorting must not move them — this
    // is what keeps a paginated level correct as later pages append.
    const serverOrder = [
      row({ title_english: "Akira" }),
      row({ title_english: "Bleach" }),
      row({ title_english: "Naruto" }),
    ];
    const resorted = [...serverOrder].sort((a, b) =>
      compareTitleKeys(levelTitleKey(a), levelTitleKey(b)),
    );
    expect(resorted).toEqual(serverOrder);
  });
});
