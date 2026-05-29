import { useTranslation } from "react-i18next";

import { useMediaList } from "../hooks/useMediaList";
import type { MediaFilters } from "../lib/api";
import type { MediaRow } from "../lib/types";
import { MediaCard } from "./MediaCard";
import { SeriesCard } from "./SeriesCard";

type Cell =
  | { kind: "single"; row: MediaRow }
  | { kind: "series"; seriesId: string; members: MediaRow[] };

// Collapse rows that share a series_id into one grouped cell. A series with only
// one member in the current list renders as a normal card (no group wrapper).
// The grouped cell takes the position of the series' FIRST member, so grouping
// doesn't reshuffle the server/client sort order around it.
function groupItems(items: MediaRow[]): Cell[] {
  const groups = new Map<string, MediaRow[]>();
  for (const it of items) {
    if (it.series_id) {
      const arr = groups.get(it.series_id);
      if (arr) arr.push(it);
      else groups.set(it.series_id, [it]);
    }
  }
  const cells: Cell[] = [];
  const emitted = new Set<string>();
  for (const it of items) {
    if (it.series_id) {
      const members = groups.get(it.series_id)!;
      if (members.length > 1) {
        if (emitted.has(it.series_id)) continue;
        emitted.add(it.series_id);
        cells.push({ kind: "series", seriesId: it.series_id, members });
      } else {
        cells.push({ kind: "single", row: it });
      }
    } else {
      cells.push({ kind: "single", row: it });
    }
  }
  return cells;
}

export function MediaList({ filters }: { filters: MediaFilters }) {
  const { t } = useTranslation();
  const { data, isPending, isError } = useMediaList(filters);

  if (isPending) {
    return (
      <p className="py-8 text-zinc-400 light:text-zinc-500">
        {t("list.loading")}
      </p>
    );
  }
  if (isError) {
    return (
      <p className="py-8 text-red-400 light:text-red-600">{t("list.error")}</p>
    );
  }

  const { items, total } = data;

  return (
    <>
      <p className="mb-3 text-xs text-zinc-500 light:text-zinc-600">
        {t("list.count", { shown: items.length, total })}
      </p>
      {items.length === 0 ? (
        <p className="py-8 text-zinc-400 light:text-zinc-500">
          {t("list.empty")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {groupItems(items).map((cell) =>
            cell.kind === "series" ? (
              <SeriesCard
                key={`s:${cell.seriesId}`}
                seriesId={cell.seriesId}
                members={cell.members}
              />
            ) : (
              <MediaCard key={cell.row.id} media={cell.row} />
            ),
          )}
        </div>
      )}
    </>
  );
}
