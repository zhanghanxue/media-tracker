import { useTranslation } from "react-i18next";

import type { MediaStatus } from "../../worker/db/schema";
import type { Collection } from "../lib/types";

const STATUS_STYLES: Record<MediaStatus, string> = {
  planned: "bg-zinc-700 text-zinc-200 light:bg-zinc-200 light:text-zinc-700",
  in_progress: "bg-blue-500/20 text-blue-300 light:bg-blue-100 light:text-blue-700",
  completed: "bg-green-500/20 text-green-300 light:bg-green-100 light:text-green-700",
  dropped: "bg-red-500/20 text-red-300 light:bg-red-100 light:text-red-700",
  paused: "bg-amber-500/20 text-amber-300 light:bg-amber-100 light:text-amber-700",
};

// A card for a collection: cover + name + contents count + rolled-up status,
// drilling into it on click. The count + status summarize the whole SUBTREE
// (every descendant item); the parent derives them from the per-collection
// rollups. A ⚙ opens the editor without navigating in.
export function CollectionCard({
  collection,
  name,
  cover,
  count,
  completed,
  showProgress,
  status,
  childCount,
  onOpen,
  onEdit,
}: {
  collection: Collection;
  name: string;
  cover: string | null;
  count: number;
  // Completed items in the subtree, and whether to surface the completion bar
  // (suppressed on all-game collections — see MediaList). When showProgress is
  // false the card renders exactly as before.
  completed: number;
  showProgress: boolean;
  status: MediaStatus;
  childCount: number;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const parts: string[] = [];
  if (childCount > 0) parts.push(t("collection.subCount", { count: childCount }));
  parts.push(t("collection.itemCount", { count }));

  // Completed-fraction for the bottom bar — mirrors MediaCard's watched bar, but
  // counts finished items instead of watched episodes. Shown for any non-empty
  // collection (including all-game ones); clamps at 100%.
  const progressPct =
    showProgress && count > 0
      ? Math.min(100, Math.round((completed / count) * 100))
      : null;

  return (
    <article className="group relative overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-800 transition hover:ring-blue-500 light:bg-white light:ring-zinc-200 light:shadow-sm">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="relative aspect-[2/3] bg-zinc-800 light:bg-zinc-100">
          {cover && (
            <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
          )}
          {/* Folder badge so a collection reads differently from an item. */}
          <span className="absolute left-1 top-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
            📁 {parts.join(" · ")}
          </span>
        </div>
      </button>
      <button
        type="button"
        onClick={onEdit}
        aria-label={t("collection.edit")}
        title={t("collection.edit")}
        className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-sm text-white transition hover:bg-black/65"
      >
        ⚙
      </button>
      <div className="space-y-1 p-2">
        <h3 className="line-clamp-2 text-sm font-medium leading-tight" title={name}>
          {name}
        </h3>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className={`shrink-0 rounded px-1.5 py-0.5 ${STATUS_STYLES[status]}`}>
            {t(`status.${status}`)}
          </span>
          <span className="truncate text-zinc-400 light:text-zinc-500">
            {progressPct != null
              ? t("collection.itemsDone", { completed, total: count })
              : t("collection.open")}
          </span>
        </div>
      </div>
      {/* Completed-fraction bar pinned to the card's bottom edge (mirrors the
          item card). Shown for non-empty, non-all-game collections. */}
      {progressPct != null && (
        <div
          className="h-1 w-full bg-zinc-800 light:bg-zinc-200"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-green-500 transition-[width]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </article>
  );
}
