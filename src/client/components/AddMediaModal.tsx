import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAniListSearch } from "../hooks/useAniListSearch";
import { useAddMedia } from "../hooks/useAddMedia";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import type { AniListSearchItem, SearchType } from "../lib/api";
import type { MediaStatus } from "../../worker/db/schema";

// Statuses offered at add-time (paused is an edit-time state, omitted here).
const ADD_STATUSES: MediaStatus[] = [
  "planned",
  "in_progress",
  "completed",
  "dropped",
];

// AniList's ANIME/MANGA search type maps to our coarse media type; the server
// refines manga vs light_novel from `format` on insert.
function mediaTypeFor(searchType: SearchType): "animation" | "manga" {
  return searchType === "ANIME" ? "animation" : "manga";
}

function metaLine(item: AniListSearchItem): string {
  const parts: string[] = [];
  if (item.format) parts.push(item.format);
  if (item.seasonYear) parts.push(String(item.seasonYear));
  if (item.episodes) parts.push(`${item.episodes} ep`);
  else if (item.chapters) parts.push(`${item.chapters} ch`);
  return parts.join(" · ");
}

export function AddMediaModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [searchType, setSearchType] = useState<SearchType>("ANIME");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<MediaStatus>("planned");
  const debouncedQuery = useDebouncedValue(input, 300);

  const search = useAniListSearch(debouncedQuery, searchType);
  const addMutation = useAddMedia();

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pendingId = addMutation.isPending
    ? addMutation.variables?.external_id
    : undefined;

  const handleAdd = (item: AniListSearchItem) => {
    addMutation.mutate({
      external_source: "anilist",
      external_id: item.id,
      type: mediaTypeFor(searchType),
      status,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-16"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-700 light:bg-white light:ring-zinc-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("add.title")}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 p-4 light:border-zinc-200">
          <h2 className="text-base font-semibold">{t("add.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("add.close")}
            className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-800 light:text-zinc-500 light:hover:bg-zinc-100"
          >
            ✕
          </button>
        </div>

        {/* Controls */}
        <div className="space-y-3 border-b border-zinc-800 p-4 light:border-zinc-200">
          <div className="flex gap-2">
            {(["ANIME", "MANGA"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setSearchType(type)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  searchType === type
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 light:bg-zinc-100 light:text-zinc-600 light:hover:bg-zinc-200"
                }`}
              >
                {t(type === "ANIME" ? "add.anime" : "add.manga")}
              </button>
            ))}
          </div>

          <input
            type="search"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("add.searchPlaceholder")}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none light:border-zinc-300 light:bg-white light:text-zinc-900 light:placeholder:text-zinc-400"
          />

          <label className="flex items-center gap-2 text-sm text-zinc-300 light:text-zinc-600">
            {t("add.statusLabel")}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as MediaStatus)}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 light:border-zinc-300 light:bg-white light:text-zinc-900"
            >
              {ADD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {debouncedQuery.trim().length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("add.empty")}
            </p>
          ) : search.isPending ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("add.searching")}
            </p>
          ) : search.isError ? (
            <p className="py-8 text-center text-sm text-red-400 light:text-red-600">
              {t("add.error")}
            </p>
          ) : search.data.results.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("add.noResults")}
            </p>
          ) : (
            <ul className="space-y-2">
              {search.data.results.map((item) => (
                <li
                  key={item.id}
                  className="flex gap-3 rounded-md p-2 hover:bg-zinc-800 light:hover:bg-zinc-100"
                >
                  <div className="h-20 w-14 shrink-0 overflow-hidden rounded bg-zinc-800 light:bg-zinc-100">
                    {item.coverImage.extraLarge && (
                      <img
                        src={item.coverImage.extraLarge}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.title.romaji ??
                        item.title.english ??
                        item.title.native}
                    </p>
                    {item.title.english &&
                      item.title.english !== item.title.romaji && (
                        <p className="truncate text-xs text-zinc-400 light:text-zinc-500">
                          {item.title.english}
                        </p>
                      )}
                    {item.title.native && (
                      <p className="truncate text-xs text-zinc-400 light:text-zinc-500">
                        {item.title.native}
                      </p>
                    )}
                    <p className="text-xs text-zinc-500">{metaLine(item)}</p>
                  </div>
                  <div className="flex shrink-0 items-center">
                    {item.alreadyAdded ? (
                      <span className="rounded px-2 py-1 text-xs text-zinc-500">
                        {t("add.alreadyAdded")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAdd(item)}
                        disabled={pendingId === item.id}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                      >
                        {pendingId === item.id
                          ? t("add.adding")
                          : t("add.addButton")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
