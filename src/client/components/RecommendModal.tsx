import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCloseOnBack } from "../hooks/useCloseOnBack";
import {
  useRecommendations,
  useAddRecommendation,
} from "../hooks/useRecommendations";
import { useRecommendChineseTitles } from "../hooks/useRecommendChineseTitles";
import { uiLangFromI18n } from "../lib/displayTitle";
import type { Recommendation, RecommendType } from "../lib/recommend";

// Feature B UI. A type row → "Recommend" → a grid of 15 cards (cover, title,
// "because you have …", Add). Standalone (does NOT touch the Add modal); reuses
// the add flow via useAddRecommendation. Mirrors AddMediaModal's shell/styles.
// The fetch returns a ranked pool of up to 60; "换一批" rotates through it in
// batches of 15 (wrapping) without refetching.
const TYPES: RecommendType[] = ["animation", "movie", "drama", "variety", "game"];
const BATCH = 15;

export function RecommendModal({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  // Mobile back-swipe (history back) closes the modal instead of leaving the app.
  useCloseOnBack(onClose);
  const [type, setType] = useState<RecommendType | null>(null);
  const [offset, setOffset] = useState(0);
  const recs = useRecommendations(type);

  const pool = recs.data ?? [];
  // The pool can shrink under the offset (adding a card refetches the exclusion).
  const safeOffset = offset < pool.length ? offset : 0;
  // Memoized (stable identity) so the Chinese-title effect doesn't refire per render.
  const visible = useMemo(
    () => (recs.data ?? []).slice(safeOffset, safeOffset + BATCH),
    [recs.data, safeOffset],
  );

  // AniList cards get their Chinese titles resolved from Bangumi in the
  // background (Chinese UI only); cards render native title until then.
  const lang = uiLangFromI18n(i18n.language);
  const resolvedCn = useRecommendChineseTitles(visible, lang === "zh");

  const cardTitle = (rec: Recommendation): string =>
    lang === "zh"
      ? (resolvedCn[`${rec.source}:${rec.id}`] ??
        rec.titleChinese ??
        rec.titleNative ??
        rec.title)
      : rec.title;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm ${
      active
        ? "bg-blue-600 text-white"
        : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 light:bg-zinc-100 light:text-zinc-600 light:hover:bg-zinc-200"
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-16"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-700 light:bg-white light:ring-zinc-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("recommend.title")}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 p-4 light:border-zinc-200">
          <h2 className="text-base font-semibold">{t("recommend.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("add.close")}
            className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-800 light:text-zinc-500 light:hover:bg-zinc-100"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 border-b border-zinc-800 p-4 light:border-zinc-200">
          <p className="text-xs text-zinc-500">{t("recommend.intro")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {TYPES.map((ty) => (
              <button
                key={ty}
                type="button"
                onClick={() => {
                  setType(ty);
                  setOffset(0);
                }}
                className={tabClass(type === ty)}
              >
                {t(`type.${ty}`)}
              </button>
            ))}
            {pool.length > BATCH && (
              <button
                type="button"
                onClick={() =>
                  setOffset(
                    safeOffset + BATCH >= pool.length ? 0 : safeOffset + BATCH,
                  )
                }
                className="ml-auto rounded-md px-3 py-1.5 text-sm text-blue-400 hover:bg-zinc-800 light:text-blue-600 light:hover:bg-zinc-100"
              >
                {t("recommend.shuffle")} ({Math.floor(safeOffset / BATCH) + 1}/
                {Math.ceil(pool.length / BATCH)})
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {type === null ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("recommend.pickType")}
            </p>
          ) : recs.isPending ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("recommend.loading")}
            </p>
          ) : recs.isError ? (
            <div className="py-8 text-center">
              <p className="text-sm text-red-400 light:text-red-600">
                {t("recommend.error")}
              </p>
              <button
                type="button"
                onClick={() => void recs.refetch()}
                className="mt-2 text-xs text-blue-400 hover:underline light:text-blue-600"
              >
                {t("recommend.retry")}
              </button>
            </div>
          ) : pool.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("recommend.empty")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {visible.map((rec) => (
                <RecommendCard
                  key={`${rec.source}:${rec.id}`}
                  rec={rec}
                  title={cardTitle(rec)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RecommendCard({ rec, title }: { rec: Recommendation; title: string }) {
  const { t } = useTranslation();
  const add = useAddRecommendation();
  const [added, setAdded] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-800 light:bg-white light:ring-zinc-200 light:shadow-sm">
      <div className="relative aspect-[2/3] bg-zinc-800 light:bg-zinc-100">
        {rec.coverUrl && (
          <img
            src={rec.coverUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="space-y-1 p-2">
        <h3 className="line-clamp-2 text-sm font-medium leading-tight" title={title}>
          {title}
        </h3>
        <p
          className="line-clamp-2 text-[11px] text-zinc-500"
          title={t("recommend.because", { title: rec.becauseTitle })}
        >
          {t("recommend.because", { title: rec.becauseTitle })}
        </p>
        <button
          type="button"
          disabled={add.isPending || added}
          onClick={() =>
            add.mutate(rec, { onSuccess: () => setAdded(true) })
          }
          className="w-full rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {added
            ? t("recommend.added")
            : add.isPending
              ? t("add.adding")
              : t("add.addButton")}
        </button>
        {add.isError && !added && (
          <p className="text-[11px] text-red-400 light:text-red-600">
            {t("add.addFailed")}
          </p>
        )}
      </div>
    </div>
  );
}
