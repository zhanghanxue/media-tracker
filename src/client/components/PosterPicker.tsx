import { useTranslation } from "react-i18next";

import {
  posterThumbUrl,
  usePosterChoices,
  useSetCover,
} from "../hooks/usePosterChoices";

/**
 * A grid of every poster TMDB has for one item, for pinning a different cover.
 *
 * Deliberately NOT part of the add flow: the automatic origin-language pick is
 * right almost always and a chooser on every add would be friction on the one
 * action the user repeats most. This opens on demand, from the item editor, for
 * the minority of items where the automatic pick is wrong.
 *
 * Clicking commits immediately (like CollectionEditor's cover chooser) rather
 * than staging into the editor's Save — the cover is stored server-side as a
 * re-hosted R2 object, not as a form field.
 */
export function PosterPicker({
  mediaId,
  currentCoverUrl,
  onClose,
}: {
  mediaId: number;
  currentCoverUrl: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: posters, isPending, isError } = usePosterChoices(mediaId, true);
  const setCover = useSetCover(mediaId);

  // The stored cover is an R2 URL, so it can't be compared to a TMDB path
  // directly; the file name is the one part both carry.
  const currentFile = currentCoverUrl?.split("/").pop()?.split("?")[0] ?? null;

  return (
    <div className="mt-2 rounded-md border border-zinc-800 p-2 light:border-zinc-200">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-zinc-400 light:text-zinc-500">
          {t("editor.posterPick")}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-zinc-500 hover:underline"
        >
          {t("editor.posterClose")}
        </button>
      </div>

      {isPending ? (
        <p className="py-4 text-center text-xs text-zinc-500">
          {t("editor.posterLoading")}
        </p>
      ) : isError ? (
        <p className="py-4 text-center text-xs text-red-400 light:text-red-600">
          {t("editor.posterFailed")}
        </p>
      ) : !posters || posters.length === 0 ? (
        <p className="py-4 text-center text-xs text-zinc-500">
          {t("editor.posterEmpty")}
        </p>
      ) : (
        <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
          {posters.map((p) => {
            const selected = currentFile !== null && p.path.endsWith(currentFile);
            return (
              <button
                key={p.path}
                type="button"
                title={p.language ?? t("editor.posterTextless")}
                onClick={() => setCover.mutate(p.path)}
                disabled={setCover.isPending}
                className={`h-16 w-11 shrink-0 overflow-hidden rounded ring-2 disabled:opacity-50 ${
                  selected
                    ? "ring-amber-400"
                    : "ring-transparent hover:ring-blue-500"
                }`}
              >
                <img
                  src={posterThumbUrl(p)}
                  alt={p.language ?? ""}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            );
          })}
        </div>
      )}

      {setCover.isError && (
        <p className="mt-1 text-xs text-red-400 light:text-red-600">
          {t("editor.posterSetFailed")}
        </p>
      )}
    </div>
  );
}
