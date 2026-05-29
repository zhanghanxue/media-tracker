// Title display rules — DESIGN.md §7. Pure, so it's the one piece of client
// logic that gets a unit test (TitleDisplay is a priority-1 TDD module in
// TESTING.md). React components around it stay untested in v1.
//
//   English UI: title_english || title_romaji || title_native
//   Chinese UI: title_chinese || title_native || title_english
//
// The `?? ... ?? ""` chain treats NULL (and only NULL) as "missing" — an empty
// string from the DB would be an upstream data bug, not a fallback trigger.

import type { UiLang } from "./types";

interface TitleFields {
  title_native: string | null;
  title_romaji: string | null;
  title_english: string | null;
  title_chinese: string | null;
}

export function displayTitle(media: TitleFields, lang: UiLang): string {
  if (lang === "zh") {
    return (
      media.title_chinese ?? media.title_native ?? media.title_english ?? ""
    );
  }
  return media.title_english ?? media.title_romaji ?? media.title_native ?? "";
}

/** Collapse an i18next language code ("en", "zh-Hans", "zh-CN") to a UiLang. */
export function uiLangFromI18n(language: string): UiLang {
  return language.startsWith("zh") ? "zh" : "en";
}

/**
 * Locale-aware comparator for "Title A–Z" sorting, by the displayed title.
 * Uses the language's collation: PINYIN order for Chinese (so 火影忍者 < 死神,
 * which code-point order — what SQLite does — gets backwards) and dictionary
 * order for English. `numeric` so "Movie 2" < "Movie 10". This is why title
 * sorting runs in the client: SQLite can't do pinyin collation.
 */
export function compareByDisplayTitle(
  a: TitleFields,
  b: TitleFields,
  lang: UiLang,
): number {
  return displayTitle(a, lang).localeCompare(displayTitle(b, lang), lang, {
    numeric: true,
    sensitivity: "base",
  });
}
