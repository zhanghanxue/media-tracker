// i18next setup (DESIGN.md §7): English + Simplified Chinese, browser-language
// auto-detect on first visit, choice persisted to localStorage. Imported for
// its side effect (init) from main.tsx before the app renders.
//
// The Simplified-Chinese bundle (locales/zh-Hans.json) is registered under the
// `zh` key with load:"languageOnly", so any Chinese navigator locale
// (zh, zh-CN, zh-TW, zh-Hans) collapses to it instead of falling back to en.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import zhHans from "./locales/zh-Hans.json";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zhHans },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "zh"],
    load: "languageOnly", // zh-CN / zh-TW -> zh
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "lang",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
  });

export default i18n;
