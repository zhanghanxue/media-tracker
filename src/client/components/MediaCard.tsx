import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { MediaStatus } from "../../worker/db/schema";
import { displayTitle, uiLangFromI18n } from "../lib/displayTitle";
import { mediaProgress, type Progress } from "../lib/progress";
import type { MediaRow } from "../lib/types";

const STATUS_STYLES: Record<MediaStatus, string> = {
  planned: "bg-zinc-700 text-zinc-200",
  in_progress: "bg-blue-500/20 text-blue-300",
  completed: "bg-green-500/20 text-green-300",
  dropped: "bg-red-500/20 text-red-300",
  paused: "bg-amber-500/20 text-amber-300",
};

function progressLabel(t: TFunction, p: Progress): string {
  switch (p.kind) {
    case "episodes":
      if (p.current != null && p.total != null)
        return t("progress.episodes", { current: p.current, total: p.total });
      if (p.current != null)
        return t("progress.episodesCurrentOnly", { current: p.current });
      return t("progress.episodesNone");
    case "chapters":
      if (p.current != null && p.total != null)
        return t("progress.chapters", { current: p.current, total: p.total });
      if (p.current != null)
        return t("progress.chaptersCurrentOnly", { current: p.current });
      return t("progress.chaptersNone");
    case "text":
      return p.value;
    case "none":
      return t("progress.none");
  }
}

export function MediaCard({ media }: { media: MediaRow }) {
  const { t, i18n } = useTranslation();
  const title = displayTitle(media, uiLangFromI18n(i18n.language));
  const progress = progressLabel(t, mediaProgress(media));

  return (
    <article className="group overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-800 transition hover:ring-blue-500">
      <div className="aspect-[2/3] bg-zinc-800">
        {media.cover_url && (
          <img
            src={media.cover_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
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
            className={`rounded px-1.5 py-0.5 ${STATUS_STYLES[media.status]}`}
          >
            {t(`status.${media.status}`)}
          </span>
          <span className="truncate text-zinc-400">{progress}</span>
        </div>
      </div>
    </article>
  );
}
