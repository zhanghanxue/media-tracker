import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useTmdbSeasons } from "../hooks/useTmdbSeasons";
import {
  tmdbCover,
  tmdbDisplayTitle,
  tmdbOriginalTitle,
  tmdbYear,
  type TmdbKind,
  type TmdbSearchResultRaw,
} from "../lib/tmdbSearch";

// One TMDB search result. For tv, a "Seasons" toggle lazily fetches the show's
// seasons and lets the user add a specific season (pre-linked into the show's
// series) instead of — or as well as — the whole show as a single row.
export function TmdbResultRow({
  item,
  kind,
  maybeInLibrary,
  pendingShow,
  pendingSeason,
  onAddShow,
  onAddSeason,
}: {
  item: TmdbSearchResultRaw;
  kind: TmdbKind;
  maybeInLibrary: boolean;
  pendingShow: boolean;
  pendingSeason: number | null;
  onAddShow: () => void;
  onAddSeason: (seasonNumber: number) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const seasonsQuery = useTmdbSeasons(kind === "tv" && open ? item.id : null);

  const cover = tmdbCover(item);
  const display = tmdbDisplayTitle(item);
  const original = tmdbOriginalTitle(item);
  const year = tmdbYear(item);

  return (
    <li className="rounded-md p-2 hover:bg-zinc-800 light:hover:bg-zinc-100">
      <div className="flex gap-3">
        <div className="h-20 w-14 shrink-0 overflow-hidden rounded bg-zinc-800 light:bg-zinc-100">
          {cover && (
            <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{display}</p>
          {original && original !== display && (
            <p className="truncate text-xs text-zinc-400 light:text-zinc-500">{original}</p>
          )}
          <p className="text-xs text-zinc-500">
            {[t(kind === "movie" ? "add.movie" : "add.tv"), year].filter(Boolean).join(" · ")}
          </p>
          {kind === "tv" && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="mt-1 text-xs text-blue-400 hover:underline light:text-blue-600"
            >
              {open ? t("add.hideSeasons") : t("add.showSeasons")}
            </button>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={onAddShow}
            disabled={pendingShow}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {pendingShow ? t("add.adding") : t(kind === "tv" ? "add.addShow" : "add.addButton")}
          </button>
          {maybeInLibrary && (
            <span className="text-[10px] text-amber-400 light:text-amber-600">
              {t("add.maybeInLibrary")}
            </span>
          )}
        </div>
      </div>

      {kind === "tv" && open && (
        <div className="mt-2 rounded-md border border-zinc-700 bg-zinc-950/40 p-2 light:border-zinc-300 light:bg-white">
          {seasonsQuery.isPending ? (
            <p className="py-2 text-center text-xs text-zinc-500">{t("add.searching")}</p>
          ) : seasonsQuery.isError ? (
            <p className="py-2 text-center text-xs text-red-400 light:text-red-600">
              {t("add.error")}
            </p>
          ) : seasonsQuery.data.length === 0 ? (
            <p className="py-2 text-center text-xs text-zinc-500">{t("add.noSeasons")}</p>
          ) : (
            <ul className="space-y-1">
              {seasonsQuery.data.map((s) => (
                <li
                  key={s.season_number}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate text-zinc-300 light:text-zinc-600">
                    {s.name ?? `S${s.season_number}`}
                    {s.episode_count ? ` · ${s.episode_count} ep` : ""}
                    {s.air_date ? ` · ${s.air_date.slice(0, 4)}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAddSeason(s.season_number)}
                    disabled={pendingSeason === s.season_number}
                    className="shrink-0 rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {pendingSeason === s.season_number ? t("add.adding") : t("add.addButton")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
