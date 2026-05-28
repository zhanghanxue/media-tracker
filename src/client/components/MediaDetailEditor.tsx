import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useUpdateMedia } from "../hooks/useUpdateMedia";
import { mediaProgress } from "../lib/progress";
import type { MediaPatch } from "../../worker/api/patch-media";
import type { MediaStatus } from "../../worker/db/schema";
import type { MediaRow } from "../lib/types";

const STATUSES: MediaStatus[] = [
  "planned",
  "in_progress",
  "completed",
  "dropped",
  "paused",
];

// Long-press / right-click editor for a card: change status, set an arbitrary
// episode/chapter number, edit notes. Only changed fields are PATCHed.
export function MediaDetailEditor({
  media,
  onClose,
}: {
  media: MediaRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateMedia();

  const isGamePlaying =
    media.type === "game" && media.consumption_mode === "playing";

  const kind = mediaProgress(media).kind; // episodes | chapters | text | none
  const dimension = isGamePlaying
    ? null
    : kind === "chapters"
      ? "chapter"
      : kind === "episodes"
        ? "episode"
        : null;
  const initialCount =
    dimension === "chapter"
      ? media.current_chapter
      : dimension === "episode"
        ? media.current_episode
        : null;
  // Read-only season/series total shown beside the editable current count.
  const total =
    dimension === "chapter"
      ? media.total_chapters
      : dimension === "episode"
        ? media.total_episodes
        : null;

  const [status, setStatus] = useState<MediaStatus>(media.status);
  const [count, setCount] = useState(
    initialCount != null ? String(initialCount) : "",
  );
  const [gameProgress, setGameProgress] = useState(media.game_progress ?? "");
  const [notes, setNotes] = useState(media.notes ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = () => {
    const patch: MediaPatch = {};
    if (status !== media.status) patch.status = status;
    if (notes !== (media.notes ?? "")) patch.notes = notes === "" ? null : notes;

    if (isGamePlaying) {
      if (gameProgress !== (media.game_progress ?? "")) {
        patch.game_progress = gameProgress === "" ? null : gameProgress;
      }
    } else if (dimension) {
      const parsed = count.trim() === "" ? null : Math.max(0, Math.floor(Number(count)));
      const current =
        dimension === "chapter" ? media.current_chapter : media.current_episode;
      if (parsed !== current && Number.isFinite(parsed ?? 0)) {
        if (dimension === "chapter") patch.current_chapter = parsed;
        else patch.current_episode = parsed;
      }
    }

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    update.mutate({ id: media.id, patch }, { onSuccess: onClose });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-lg bg-zinc-900 p-4 ring-1 ring-zinc-700 light:bg-white light:ring-zinc-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("editor.title")}
      >
        <h2 className="text-base font-semibold">{t("editor.title")}</h2>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-400 light:text-zinc-500">
            {t("editor.status")}
          </span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as MediaStatus)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>

        {dimension && (
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-400 light:text-zinc-500">
              {t(dimension === "chapter" ? "editor.chapter" : "editor.episode")}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="1"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
              />
              {total != null && (
                <span className="text-zinc-400 light:text-zinc-500">
                  {t("editor.ofTotal", { total })}
                </span>
              )}
            </div>
          </label>
        )}

        {isGamePlaying && (
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-400 light:text-zinc-500">
              {t("editor.progress")}
            </span>
            <input
              type="text"
              value={gameProgress}
              onChange={(e) => setGameProgress(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
            />
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-400 light:text-zinc-500">
            {t("editor.notes")}
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 light:border-zinc-300 light:bg-white"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 light:text-zinc-600 light:hover:bg-zinc-100"
          >
            {t("editor.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={update.isPending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {t("editor.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
