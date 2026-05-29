import { describe, expect, it } from "vitest";

import {
  compareByDisplayTitle,
  displayTitle,
  uiLangFromI18n,
} from "./displayTitle";

const FULL = {
  title_native: "鬼滅の刃",
  title_romaji: "Kimetsu no Yaiba",
  title_english: "Demon Slayer",
  title_chinese: "鬼灭之刃",
};

describe("displayTitle — English UI", () => {
  it("prefers english, then romaji, then native", () => {
    expect(displayTitle(FULL, "en")).toBe("Demon Slayer");
    expect(
      displayTitle({ ...FULL, title_english: null }, "en"),
    ).toBe("Kimetsu no Yaiba");
    expect(
      displayTitle(
        { ...FULL, title_english: null, title_romaji: null },
        "en",
      ),
    ).toBe("鬼滅の刃");
  });

  it("does NOT fall through to the chinese title in English mode", () => {
    const onlyChinese = {
      title_native: null,
      title_romaji: null,
      title_english: null,
      title_chinese: "鬼灭之刃",
    };
    expect(displayTitle(onlyChinese, "en")).toBe("");
  });
});

describe("displayTitle — Chinese UI", () => {
  it("prefers chinese, then native, then english", () => {
    expect(displayTitle(FULL, "zh")).toBe("鬼灭之刃");
    expect(
      displayTitle({ ...FULL, title_chinese: null }, "zh"),
    ).toBe("鬼滅の刃");
    expect(
      displayTitle(
        { ...FULL, title_chinese: null, title_native: null },
        "zh",
      ),
    ).toBe("Demon Slayer");
  });

  it("falls back to native (Japanese kanji) when chinese is missing — the known AniList gap", () => {
    const fromAniList = {
      title_native: "鬼滅の刃",
      title_romaji: "Kimetsu no Yaiba",
      title_english: "Demon Slayer",
      title_chinese: null, // AniList never supplies this
    };
    expect(displayTitle(fromAniList, "zh")).toBe("鬼滅の刃");
  });

  it("returns empty string when every title is null", () => {
    expect(
      displayTitle(
        {
          title_native: null,
          title_romaji: null,
          title_english: null,
          title_chinese: null,
        },
        "zh",
      ),
    ).toBe("");
  });
});

describe("compareByDisplayTitle", () => {
  const naruto = {
    title_native: "NARUTO -ナルト-",
    title_romaji: "NARUTO",
    title_english: "Naruto",
    title_chinese: "火影忍者",
  };
  const bleach = {
    title_native: "BLEACH",
    title_romaji: "BLEACH",
    title_english: "Bleach",
    title_chinese: "死神",
  };

  it("orders Chinese titles by PINYIN, not code point (火影忍者 before 死神)", () => {
    // Code point would put 死 (0x6b7b) before 火 (0x706b) — wrong. Pinyin: huǒ < sǐ.
    expect(compareByDisplayTitle(naruto, bleach, "zh")).toBeLessThan(0);
    expect(compareByDisplayTitle(bleach, naruto, "zh")).toBeGreaterThan(0);
  });

  it("orders English titles alphabetically (Bleach before Naruto)", () => {
    expect(compareByDisplayTitle(bleach, naruto, "en")).toBeLessThan(0);
  });

  it("sorts numbers naturally (Movie 2 before Movie 10)", () => {
    const m2 = { title_native: null, title_romaji: null, title_english: "Movie 2", title_chinese: null };
    const m10 = { title_native: null, title_romaji: null, title_english: "Movie 10", title_chinese: null };
    expect(compareByDisplayTitle(m2, m10, "en")).toBeLessThan(0);
  });
});

describe("uiLangFromI18n", () => {
  it("maps zh-* variants to zh", () => {
    expect(uiLangFromI18n("zh-Hans")).toBe("zh");
    expect(uiLangFromI18n("zh-CN")).toBe("zh");
    expect(uiLangFromI18n("zh")).toBe("zh");
  });

  it("maps everything else to en", () => {
    expect(uiLangFromI18n("en")).toBe("en");
    expect(uiLangFromI18n("en-US")).toBe("en");
    expect(uiLangFromI18n("fr")).toBe("en");
  });
});
