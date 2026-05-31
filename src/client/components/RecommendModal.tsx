import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  useRecommendations,
  useAddRecommendation,
} from "../hooks/useRecommendations";
import type { Recommendation, RecommendType } from "../lib/recommend";

// Feature B UI. A type row → "Recommend" → a grid of 10–15 cards (cover, title,
// "because you have …", Add). Standalone (does NOT touch the Add modal); reuses
// the add flow via useAddRecommendation. Mirrors AddMediaModal's shell/styles.
const TYPES: RecommendType[] = ["animation", "movie", "drama", "variety", "game"];

export function RecommendModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [type, setType] = useState<RecommendType | null>(null);
  const recs = useRecommendations(type);

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
          <div className="flex flex-wrap gap-2">
            {TYPES.map((ty) => (
              <button
                key={ty}
                type="button"
                onClick={() => setType(ty)}
                className={tabClass(type === ty)}
              >
                {t(`type.${ty}`)}
              </button>
            ))}
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
          ) : recs.data.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("recommend.empty")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {recs.data.map((rec) => (
                <RecommendCard key={`${rec.source}:${rec.id}`} rec={rec} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RecommendCard({ rec }: { rec: Recommendation }) {
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
        <h3 className="line-clamp-2 text-sm font-medium leading-tight" title={rec.title}>
          {rec.title}
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
      </div>
    </div>
  );
}
