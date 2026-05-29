import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAniListSearch } from "../hooks/useAniListSearch";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import type { SearchType } from "../lib/api";
import type { MediaType } from "../../worker/db/schema";

export interface PickedAniListTitles {
  english: string | null;
  romaji: string | null;
}

// Manual AniList search → pick an entry → return its English + romaji titles, to
// "link" a Bangumi-direct row to its AniList equivalent (fills the Latin titles
// AniList models better — e.g. mapping Bangumi's "S2 前編" to AniList's entry).
// Pulls titles only; it does not re-key the row's source.
export function AniListTitlePicker({
  mediaType,
  initialQuery,
  onPick,
}: {
  mediaType: MediaType;
  initialQuery: string;
  onPick: (titles: PickedAniListTitles) => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState(initialQuery);
  const debounced = useDebouncedValue(input, 350);
  const searchType: SearchType =
    mediaType === "manga" || mediaType === "light_novel" ? "MANGA" : "ANIME";
  const search = useAniListSearch(debounced, searchType);

  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-950/40 p-2 light:border-zinc-300 light:bg-zinc-50">
      <input
        type="search"
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={t("picker.searchPlaceholderAniList")}
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none light:border-zinc-300 light:bg-white light:text-zinc-900"
      />

      <div className="mt-2 max-h-56 overflow-y-auto">
        {debounced.trim().length === 0 ? (
          <p className="py-3 text-center text-xs text-zinc-500">
            {t("picker.emptyAniList")}
          </p>
        ) : search.isPending ? (
          <p className="py-3 text-center text-xs text-zinc-500">
            {t("picker.searching")}
          </p>
        ) : search.isError ? (
          <p className="py-3 text-center text-xs text-red-400 light:text-red-600">
            {t("picker.error")}
          </p>
        ) : search.data.results.length === 0 ? (
          <p className="py-3 text-center text-xs text-zinc-500">
            {t("picker.noResults")}
          </p>
        ) : (
          <ul className="space-y-1">
            {search.data.results.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() =>
                    onPick({
                      english: item.title.english,
                      romaji: item.title.romaji,
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-zinc-800 light:hover:bg-zinc-100"
                >
                  <div className="h-12 w-9 shrink-0 overflow-hidden rounded bg-zinc-800 light:bg-zinc-200">
                    {item.coverImage.extraLarge && (
                      <img
                        src={item.coverImage.extraLarge}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.title.english ?? item.title.romaji}
                    </p>
                    {item.title.romaji &&
                      item.title.romaji !== item.title.english && (
                        <p className="truncate text-xs text-zinc-400 light:text-zinc-500">
                          {item.title.romaji}
                        </p>
                      )}
                    {item.title.native && (
                      <p className="truncate text-xs text-zinc-500">
                        {item.title.native}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
