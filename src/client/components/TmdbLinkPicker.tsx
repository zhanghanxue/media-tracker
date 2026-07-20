import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useTmdbSearch } from "../hooks/useTmdbSearch";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { SEARCH_DEBOUNCE_MS, isSearchable } from "../lib/searchTuning";
import {
  tmdbCover,
  tmdbDisplayTitle,
  tmdbOriginalTitle,
  tmdbYear,
} from "../lib/tmdbSearch";
import type { TmdbKind } from "../../worker/sources/tmdb";

export interface PickedTmdbItem {
  // Kind-prefixed id ("movie:603" / "tv:1399") — stored as tmdb_id, matching how
  // the library stores TMDB external_id, so cross-source dedup compares like.
  id: string;
  // English-ish display title (the editor fills title_english with it).
  title: string;
}

// Manual TMDB search → pick a movie/tv entry → return its kind-prefixed id +
// title, to link a row to its TMDB equivalent and fill the English title.
// Mirrors AniListTitlePicker / IgdbLinkPicker. TMDB is key-bearing, so search
// goes through the Worker proxy (useTmdbSearch). `kind` is fixed by the caller:
// drama/variety → "tv", movie → "movie".
export function TmdbLinkPicker({
  kind,
  initialQuery,
  onPick,
}: {
  kind: TmdbKind;
  initialQuery: string;
  onPick: (picked: PickedTmdbItem) => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState(initialQuery);
  const [debounced, flushQuery] = useDebouncedValue(input, SEARCH_DEBOUNCE_MS);
  const search = useTmdbSearch(debounced, kind);

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
        placeholder={t("add.searchPlaceholderTmdb")}
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none light:border-zinc-300 light:bg-white light:text-zinc-900"
      />

      <div className="mt-2 max-h-56 overflow-y-auto">
        {debounced.trim().length === 0 ? (
          <p className="py-3 text-center text-xs text-zinc-500">
            {t("add.emptyTmdb")}
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
            {search.data.map((item) => {
              const cover = tmdbCover(item);
              const title = tmdbDisplayTitle(item);
              const original = tmdbOriginalTitle(item);
              const year = tmdbYear(item);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onPick({ id: `${kind}:${item.id}`, title })
                    }
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
                      <p className="truncate text-sm font-medium">{title}</p>
                      {original && original !== title && (
                        <p className="truncate text-xs text-zinc-400 light:text-zinc-500">
                          {original}
                        </p>
                      )}
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
