import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { MediaStatus } from "../../worker/db/schema";
import { useBulkDeleteMedia } from "../hooks/useBulkDeleteMedia";
import { useBulkUpdateMedia } from "../hooks/useBulkUpdateMedia";
import { CollectionPicker } from "./CollectionPicker";

const STATUSES: MediaStatus[] = [
  "planned",
  "in_progress",
  "completed",
  "dropped",
  "paused",
];

// Sticky action bar shown while in selection mode: bulk-add the selected items
// to a collection (searchable picker, create-new inline) or set their status.
// Clears the selection after a successful action.
export function BulkActionBar({
  ids,
  onClear,
  onDone,
}: {
  ids: number[];
  onClear: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const bulk = useBulkUpdateMedia();
  const del = useBulkDeleteMedia();
  const [showPicker, setShowPicker] = useState(false);

  const count = ids.length;
  const busy = bulk.isPending || del.isPending;
  const apply = (patch: Parameters<typeof bulk.mutate>[0]["patch"]) => {
    bulk.mutate({ ids, patch }, { onSuccess: () => { setShowPicker(false); onClear(); } });
  };
  // Destructive — confirm first (matches the single-item / collection deletes).
  const onDelete = () => {
    if (count === 0) return;
    if (!window.confirm(t("bulk.confirmDelete", { count }))) return;
    del.mutate(ids, { onSuccess: () => { setShowPicker(false); onClear(); } });
  };

  return (
    <div className="sticky bottom-0 z-20 mt-4 rounded-lg border border-zinc-700 bg-zinc-900/95 p-2 backdrop-blur light:border-zinc-300 light:bg-white/95">
      {showPicker && count > 0 && (
        <div className="mb-2">
          <CollectionPicker onPick={(collectionId) => apply({ collection_id: collectionId })} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-100 light:text-zinc-900">
          {t("bulk.selected", { count })}
        </span>

        <button
          type="button"
          disabled={count === 0 || busy}
          onClick={() => setShowPicker((v) => !v)}
          className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {t("bulk.addToCollection")}
        </button>

        <label className="flex items-center gap-1 text-xs text-zinc-400 light:text-zinc-500">
          {t("bulk.setStatus")}
          <select
            disabled={count === 0 || busy}
            value=""
            onChange={(e) => {
              if (e.target.value) apply({ status: e.target.value as MediaStatus });
            }}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-100 disabled:opacity-40 light:border-zinc-300 light:bg-white light:text-zinc-900"
          >
            <option value="">—</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={count === 0 || busy}
          onClick={onDelete}
          className="rounded-md bg-red-600/90 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-40"
        >
          {t("bulk.delete")}
        </button>

        <div className="ml-auto flex gap-2">
          {count > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 light:text-zinc-600 light:hover:bg-zinc-100"
            >
              {t("bulk.clear")}
            </button>
          )}
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100"
          >
            {t("bulk.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
