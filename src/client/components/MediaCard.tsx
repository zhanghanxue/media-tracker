import { useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { MediaStatus } from "../../worker/db/schema";
import { useLongPress } from "../hooks/useLongPress";
import { useUpdateMedia } from "../hooks/useUpdateMedia";
import { displayTitle, uiLangFromI18n } from "../lib/displayTitle";
import { mediaProgress, nextIncrementPatch, type Progress } from "../lib/progress";
import type { MediaRow } from "../lib/types";
import { MediaDetailEditor } from "./MediaDetailEditor";

const STATUS_STYLES: Record<MediaStatus, string> = {
  planned: "bg-zinc-700 text-zinc-200 light:bg-zinc-200 light:text-zinc-700",
  in_progress:
    "bg-blue-500/20 text-blue-300 light:bg-blue-100 light:text-blue-700",
  completed:
    "bg-green-500/20 text-green-300 light:bg-green-100 light:text-green-700",
  dropped: "bg-red-500/20 text-red-300 light:bg-red-100 light:text-red-700",
  paused:
    "bg-amber-500/20 text-amber-300 light:bg-amber-100 light:text-amber-700",
};

function progressLabel(t: TFunction, p: Progress): string {
  switch (p.kind) {
    case "episodes":
      if (p.current != null && p.total != null)
        return t("progress.episodes", { current: p.current, total: p.total });
      if (p.current != null)
        return t("progress.episodesCurrentOnly", { current: p.current });
      // Unstarted but we know the length — show the total as a clue (e.g. a
      // planned 26-ep show reads "0 / 26 ep" instead of a bare "— ep").
      if (p.total != null)
        return t("progress.episodesTotalOnly", { total: p.total });
      return t("progress.episodesNone");
    case "chapters":
      if (p.current != null && p.total != null)
        return t("progress.chapters", { current: p.current, total: p.total });
      if (p.current != null)
        return t("progress.chaptersCurrentOnly", { current: p.current });
      if (p.total != null)
        return t("progress.chaptersTotalOnly", { total: p.total });
      return t("progress.chaptersNone");
    case "text":
      return p.value;
    case "none":
      return t("progress.none");
  }
}

export function MediaCard({
  media,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  media: MediaRow;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const update = useUpdateMedia();

  const [editing, setEditing] = useState(false); // detail editor modal
  const [editingGame, setEditingGame] = useState(false); // inline game text
  const [gameText, setGameText] = useState(media.game_progress ?? "");

  const longPress = useLongPress(() => setEditing(true));

  const title = displayTitle(media, uiLangFromI18n(i18n.language));
  const progress = mediaProgress(media);
  const incrementPatch = nextIncrementPatch(media);
  const isGamePlaying =
    media.type === "game" && media.consumption_mode === "playing";
  // Has at least one attached video link (drama/variety links, watching-game
  // parts) — derived flag from the list query. When set, the card reads "linked"
  // in place of the "x / y ep" count (you track these by the links, not a number).
  const hasVideoParts = media.has_video_parts === 1;
  // Watched-fraction for the bottom bar — episode-tracked cards only, and only
  // once a total is known. Unstarted (current null) reads 0%; clamps at 100%.
  const progressPct =
    progress.kind === "episodes" &&
    progress.total != null &&
    progress.total > 0
      ? Math.min(100, Math.round(((progress.current ?? 0) / progress.total) * 100))
      : null;

  const increment = () => {
    if (incrementPatch) update.mutate({ id: media.id, patch: incrementPatch });
  };

  const saveGame = () => {
    setEditingGame(false);
    const value = gameText.trim();
    if (value !== (media.game_progress ?? "")) {
      update.mutate({
        id: media.id,
        patch: { game_progress: value === "" ? null : value },
      });
    }
  };

  return (
    <>
      <article
        {...(selectMode
          ? { onClick: () => onToggleSelect?.(media.id) }
          : {
              onContextMenu: (e: MouseEvent) => {
                e.preventDefault();
                setEditing(true);
              },
              ...longPress,
            })}
        className={`group overflow-hidden rounded-lg bg-zinc-900 transition light:bg-white light:shadow-sm ${
          selected
            ? "ring-2 ring-blue-500"
            : "ring-1 ring-zinc-800 hover:ring-blue-500 light:ring-zinc-200"
        } ${selectMode ? "cursor-pointer" : ""}`}
      >
        <div className="relative aspect-[2/3] bg-zinc-800 light:bg-zinc-100">
          {media.cover_url && (
            <img
              src={media.cover_url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
          {/* Selection checkbox overlay (top-left) in select mode. */}
          {selectMode && (
            <span
              className={`absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full text-sm ${
                selected ? "bg-blue-600 text-white" : "bg-black/45 text-white/80"
              }`}
            >
              {selected ? "✓" : ""}
            </span>
          )}
          {/* +1 floats over the cover (top-right). Hidden in select mode. */}
          {!selectMode && !isGamePlaying && incrementPatch && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                increment();
              }}
              onTouchStart={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              aria-label={t("card.increment")}
              className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full bg-black/20 text-base font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] transition hover:bg-black/35"
            >
              +1
            </button>
          )}
        </div>
        <div className="space-y-1 p-2">
          <h3
            className="line-clamp-2 text-sm font-medium leading-tight"
            title={title}
          >
            {title}
          </h3>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 ${STATUS_STYLES[media.status]}`}
            >
              {t(`status.${media.status}`)}
            </span>

            {selectMode ? (
              <span className="truncate text-zinc-400 light:text-zinc-500">
                {isGamePlaying
                  ? (media.game_progress ?? t("progress.none"))
                  : hasVideoParts
                    ? t("card.linked")
                    : progressLabel(t, progress)}
              </span>
            ) : isGamePlaying ? (
              editingGame ? (
                <input
                  autoFocus
                  value={gameText}
                  onChange={(e) => setGameText(e.target.value)}
                  onBlur={saveGame}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveGame();
                    if (e.key === "Escape") setEditingGame(false);
                  }}
                  placeholder={t("card.progressPlaceholder")}
                  className="w-24 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-100 light:border-zinc-300 light:bg-white light:text-zinc-900"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setGameText(media.game_progress ?? "");
                    setEditingGame(true);
                  }}
                  aria-label={t("card.editProgress")}
                  className="truncate text-zinc-400 hover:text-zinc-200 light:text-zinc-500 light:hover:text-zinc-800"
                >
                  {media.game_progress ?? t("progress.none")}
                </button>
              )
            ) : (
              <span className="truncate text-zinc-400 light:text-zinc-500">
                {hasVideoParts ? t("card.linked") : progressLabel(t, progress)}
              </span>
            )}
          </div>
        </div>
        {/* Watched-fraction bar pinned to the card's bottom edge (episode-tracked
            items with a known total). */}
        {progressPct != null && (
          <div
            className="h-1 w-full bg-zinc-800 light:bg-zinc-200"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-blue-500 transition-[width]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </article>

      {editing && (
        <MediaDetailEditor media={media} onClose={() => setEditing(false)} />
      )}
    </>
  );
}
