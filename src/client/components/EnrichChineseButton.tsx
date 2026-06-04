import { useTranslation } from "react-i18next";

import { useEnrichTitles } from "../hooks/useEnrichChineseTitles";

// Header control: one-shot backfill of missing titles from Bangumi — Chinese
// titles for AniList rows, Latin titles for Bangumi-direct rows. When a run
// can't match some items, it lists them (so the user knows what to fix by hand
// in the editor) instead of silently dropping them.
export function EnrichChineseButton() {
  const { t } = useTranslation();
  const { state, run, dismiss } = useEnrichTitles();

  const running = state.phase === "running";

  const label =
    state.phase === "running"
      ? t("enrich.running", { done: state.done, total: state.total })
      : state.phase === "done"
        ? t("enrich.done", {
            filled: state.filled,
            skipped: state.skippedTitles.length,
          })
        : state.phase === "none"
          ? t("enrich.none")
          : state.phase === "error"
            ? t("enrich.error")
            : t("enrich.button");

  const showSkipped = state.phase === "done" && state.skippedTitles.length > 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void run()}
        disabled={running}
        title={t("enrich.button")}
        aria-label={t("enrich.button")}
        className="rounded-md px-2.5 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-60 sm:px-2 light:text-zinc-600 light:hover:bg-zinc-100"
      >
        {/* Icon-only on mobile; the (state-dependent) label shows from sm up. */}
        <span aria-hidden="true">{t("enrich.icon")}</span>
        <span className="hidden sm:inline"> {label}</span>
      </button>

      {showSkipped && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm shadow-lg light:border-zinc-200 light:bg-white">
          <div className="mb-1 flex items-start justify-between gap-2">
            <p className="font-medium">{t("enrich.skippedHeading")}</p>
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("add.close")}
              className="text-zinc-400 hover:text-zinc-200 light:text-zinc-500 light:hover:text-zinc-700"
            >
              ✕
            </button>
          </div>
          <p className="mb-2 text-xs text-zinc-400 light:text-zinc-500">
            {t("enrich.skippedWhy")}
          </p>
          <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-4 text-xs text-zinc-300 light:text-zinc-600">
            {(state as { skippedTitles: string[] }).skippedTitles.map((title, i) => (
              <li key={i} className="truncate" title={title}>
                {title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
