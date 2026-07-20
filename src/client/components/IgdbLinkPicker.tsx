import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useIgdbSearch } from "../hooks/useIgdbSearch";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { SEARCH_DEBOUNCE_MS, isSearchable } from "../lib/searchTuning";
import { igdbCover, igdbYear } from "../lib/igdbSearch";

export interface PickedIgdbGame {
  id: number;
  name: string;
}

// Manual IGDB search → pick a game → return its id + name, to link a
// Bangumi-sourced game to its IGDB equivalent (PRD-v2 Feature C). The id is saved
// as igdb_id (a cross-reference); the row's primary source (Bangumi, with its
// Chinese title/cover) is left untouched. Mirrors AniListTitlePicker. IGDB is
// key-bearing, so search goes through the Worker proxy (useIgdbSearch).
export function IgdbLinkPicker({
  initialQuery,
  onPick,
}: {
  initialQuery: string;
  onPick: (game: PickedIgdbGame) => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState(initialQuery);
  const [debounced, flushQuery] = useDebouncedValue(input, SEARCH_DEBOUNCE_MS);
  const search = useIgdbSearch(debounced);

  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-950/40 p-2 light:border-zinc-300 light:bg-zinc-50">
      <input
        type="search"
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            flushQuery();
          }
        }}
        placeholder={t("add.searchPlaceholderIgdb")}
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none light:border-zinc-300 light:bg-white light:text-zinc-900"
      />

      <div className="mt-2 max-h-56 overflow-y-auto">
        {debounced.trim().length === 0 ? (
          <p className="py-3 text-center text-xs text-zinc-500">
            {t("add.emptyIgdb")}
          </p>
        ) : !isSearchable(debounced) ? (
          <p className="py-3 text-center text-xs text-zinc-500">
            {t("picker.keepTyping")}
          </p>
        ) : search.isPending ? (
          <p className="py-3 text-center text-xs text-zinc-500">
            {t("picker.searching")}
          </p>
        ) : search.isError ? (
          <p className="py-3 text-center text-xs text-red-400 light:text-red-600">
            {t("picker.error")}
          </p>
        ) : search.data.length === 0 ? (
          <p className="py-3 text-center text-xs text-zinc-500">
            {t("picker.noResults")}
          </p>
        ) : (
          <ul className="space-y-1">
            {search.data.map((game) => {
              const cover = igdbCover(game);
              const year = igdbYear(game);
              return (
                <li key={game.id}>
                  <button
                    type="button"
                    onClick={() => onPick({ id: game.id, name: game.name })}
                    className="flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-zinc-800 light:hover:bg-zinc-100"
                  >
                    <div className="h-12 w-9 shrink-0 overflow-hidden rounded bg-zinc-800 light:bg-zinc-200">
                      {cover && (
                        <img
                          src={cover}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{game.name}</p>
                      {year && (
                        <p className="truncate text-xs text-zinc-500">{year}</p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
