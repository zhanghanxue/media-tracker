import { useState } from "react";
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

export function MediaCard({ media }: { media: MediaRow }) {
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
        onContextMenu={(e) => {
          e.preventDefault();
          setEditing(true);
        }}
        {...longPress}
        className="group overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-800 transition hover:ring-blue-500 light:bg-white light:ring-zinc-200 light:shadow-sm"
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
          {/* +1 floats over the cover (top-right) so the footer never gets
              crowded off-screen on narrow cards. Episodic/chapter items only. */}
          {!isGamePlaying && incrementPatch && (
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

            {isGamePlaying ? (
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
                {progressLabel(t, progress)}
              </span>
            )}
          </div>
        </div>
      </article>

      {editing && (
        <MediaDetailEditor media={media} onClose={() => setEditing(false)} />
      )}
    </>
  );
}
