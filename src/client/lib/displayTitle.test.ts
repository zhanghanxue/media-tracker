import { describe, expect, it } from "vitest";

import { displayTitle, uiLangFromI18n } from "./displayTitle";

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
