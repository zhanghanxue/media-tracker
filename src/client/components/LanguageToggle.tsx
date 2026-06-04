import { useTranslation } from "react-i18next";

// Flips between English and Simplified Chinese. The label shows the language
// you'd switch TO (中文 when on English, EN when on Chinese). i18next persists
// the choice to localStorage via the detector's cache config.
export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");

  return (
    <button
      type="button"
      onClick={() => void i18n.changeLanguage(isZh ? "en" : "zh")}
      className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 sm:px-3 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100"
    >
      {t("language.switchTo")}
    </button>
  );
}
