import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { MediaStatus } from "../../worker/db/schema";
import type { MediaRow } from "../lib/types";
import { useUpdateMedia } from "../hooks/useUpdateMedia";
import { displayTitle, uiLangFromI18n } from "../lib/displayTitle";
import { mediaProgress, nextIncrementPatch } from "../lib/progress";
import { compareSeasons, seriesDisplayName } from "../lib/series";
import { MediaDetailEditor } from "./MediaDetailEditor";

const STATUS_STYLES: Record<MediaStatus, string> = {
  planned: "bg-zinc-700 text-zinc-200 light:bg-zinc-200 light:text-zinc-700",
  in_progress: "bg-blue-500/20 text-blue-300 light:bg-blue-100 light:text-blue-700",
  completed: "bg-green-500/20 text-green-300 light:bg-green-100 light:text-green-700",
  dropped: "bg-red-500/20 text-red-300 light:bg-red-100 light:text-red-700",
  paused: "bg-amber-500/20 text-amber-300 light:bg-amber-100 light:text-amber-700",
};

// A summary status for the whole series: all-done → completed, all-planned →
// planned, anything in between → in_progress.
function rollupStatus(members: MediaRow[]): MediaStatus {
  if (members.every((m) => m.status === "completed")) return "completed";
  if (members.every((m) => m.status === "planned")) return "planned";
  return "in_progress";
}

export function SeriesCard({ members }: { seriesId: string; members: MediaRow[] }) {
  const { t, i18n } = useTranslation();
  const lang = uiLangFromI18n(i18n.language);
  const update = useUpdateMedia();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MediaRow | null>(null);

  const sorted = [...members].sort(compareSeasons);
  // Auto-localized: override wins, else common-prefix of members in this language.
  const name = seriesDisplayName(members, lang);

  // Reorder by nudging: swap a member with its neighbour, then renumber the
  // whole group 1..N and persist only the rows whose season_number changed. The
  // optimistic cache update re-sorts the list live (compareSeasons reads
  // season_number), so the order shifts without a refetch.
  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= sorted.length) return;
    const reordered = [...sorted];
    [reordered[index], reordered[j]] = [reordered[j]!, reordered[index]!];
    reordered.forEach((m, i) => {
      const sn = i + 1;
      if (m.season_number !== sn) {
        update.mutate({ id: m.id, patch: { season_number: sn } });
      }
    });
  };
  const cover = sorted.find((m) => m.cover_url)?.cover_url ?? null;
  const status = rollupStatus(members);

  // Episode/chapter rollup across members that track that dimension.
  let epCur = 0, epTotal = 0, chCur = 0, chTotal = 0;
  for (const m of members) {
    if (m.total_episodes != null) {
      epTotal += m.total_episodes;
      epCur += Math.min(m.current_episode ?? 0, m.total_episodes);
    }
    if (m.total_chapters != null) {
      chTotal += m.total_chapters;
      chCur += Math.min(m.current_chapter ?? 0, m.total_chapters);
    }
  }
  const rollup =
    epTotal > 0
      ? t("progress.episodes", { current: epCur, total: epTotal })
      : chTotal > 0
        ? t("progress.chapters", { current: chCur, total: chTotal })
        : "—";

  return (
    <>
      <article className="overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-800 transition hover:ring-blue-500 light:bg-white light:ring-zinc-200 light:shadow-sm">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="block w-full text-left"
        >
          <div className="relative aspect-[2/3] bg-zinc-800 light:bg-zinc-100">
            {cover && (
              <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
            )}
            <span className="absolute left-1 top-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {t("series.seasons", { count: members.length })}
            </span>
          </div>
        </button>
        <div className="space-y-1 p-2">
          <h3 className="line-clamp-2 text-sm font-medium leading-tight" title={name}>
            {name}
          </h3>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className={`shrink-0 rounded px-1.5 py-0.5 ${STATUS_STYLES[status]}`}>
              {t(`status.${status}`)}
            </span>
            <span className="truncate text-zinc-400 light:text-zinc-500">{rollup}</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 light:bg-zinc-100 light:text-zinc-600 light:hover:bg-zinc-200"
          >
            {open
              ? t("series.collapse")
              : t("series.expand", { count: members.length })}
          </button>

          {open && (
            <ul className="space-y-1 border-t border-zinc-800 pt-1 light:border-zinc-200">
              {sorted.map((m, i) => {
                const p = mediaProgress(m);
                const inc = nextIncrementPatch(m);
                const label =
                  p.kind === "episodes"
                    ? p.current != null && p.total != null
                      ? `${p.current}/${p.total}`
                      : p.current != null
                        ? `${p.current}`
                        : "—"
                    : p.kind === "chapters"
                      ? p.current != null && p.total != null
                        ? `${p.current}/${p.total}`
                        : "—"
                      : p.kind === "text"
                        ? p.value
                        : "—";
                return (
                  <li key={m.id} className="flex items-center gap-1 text-xs">
                    <span className="flex shrink-0 flex-col -space-y-1 leading-none">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label={t("series.moveUp")}
                        className="text-[9px] text-zinc-500 hover:text-zinc-200 disabled:opacity-25 light:hover:text-zinc-800"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === sorted.length - 1}
                        aria-label={t("series.moveDown")}
                        className="text-[9px] text-zinc-500 hover:text-zinc-200 disabled:opacity-25 light:hover:text-zinc-800"
                      >
                        ▼
                      </button>
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditing(m)}
                      className="min-w-0 flex-1 truncate text-left text-zinc-300 hover:text-zinc-100 light:text-zinc-600 light:hover:text-zinc-900"
                      title={displayTitle(m, lang)}
                    >
                      {displayTitle(m, lang)}
                    </button>
                    <span
                      className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${STATUS_STYLES[m.status]}`}
                    >
                      {label}
                    </span>
                    {inc && (
                      <button
                        type="button"
                        onClick={() => update.mutate({ id: m.id, patch: inc })}
                        aria-label={t("card.increment")}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-[10px] font-bold text-white hover:bg-zinc-600 light:bg-zinc-300 light:text-zinc-700"
                      >
                        +
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </article>

      {editing && (
        <MediaDetailEditor media={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
