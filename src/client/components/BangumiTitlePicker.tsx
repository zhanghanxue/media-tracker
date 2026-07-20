import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useBangumiSearch } from "../hooks/useBangumiSearch";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { SEARCH_DEBOUNCE_MS, isSearchable } from "../lib/searchTuning";
import { bangumiCover, bangumiTypeFor } from "../lib/bangumiSearch";
import { toSimplified } from "../lib/toSimplified";
import type { MediaType } from "../../worker/db/schema";

export interface PickedBangumiSubject {
  // Bangumi subject id — the caller stores it as the row's bangumi_id cross-
  // reference so the link PERSISTS (previously only the Chinese title was saved,
  // so a Bangumi link never showed up in the editor's provenance line).
  id: number;
  chineseTitle: string;
}

// Manual Bangumi search → pick a subject → return its id + Simplified Chinese
// title. The id is saved as bangumi_id (the persistent cross-reference); the
// title fills title_chinese for the long tail the auto-enricher can't match
// confidently (movies, donghua, naming mismatches). Accepts EN / JP / Chinese
// input (searches both Bangumi endpoints).
export function BangumiTitlePicker({
  mediaType,
  initialQuery,
  onPick,
}: {
  mediaType: MediaType;
  initialQuery: string;
  onPick: (picked: PickedBangumiSubject) => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState(initialQuery);
  const [debounced, flushQuery] = useDebouncedValue(input, SEARCH_DEBOUNCE_MS);
  const type = bangumiTypeFor(mediaType);
  const search = useBangumiSearch(debounced, type);

  const pick = async (subject: { id: number; name: string; name_cn: string }) => {
    // Prefer the Chinese name; donghua sometimes carry Chinese in `name`.
    const raw = subject.name_cn?.trim() || subject.name;
    onPick({ id: subject.id, chineseTitle: await toSimplified(raw) });
  };

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
        placeholder={t("picker.searchPlaceholder")}
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none light:border-zinc-300 light:bg-white light:text-zinc-900"
      />

      <div className="mt-2 max-h-56 overflow-y-auto">
        {debounced.trim().length === 0 ? (
          <p className="py-3 text-center text-xs text-zinc-500">
            {t("picker.empty")}
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
            {search.data.map((s) => {
              const cover = bangumiCover(s);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => void pick(s)}
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
                      <p className="truncate text-sm font-medium">
                        {s.name_cn || s.name}
                      </p>
                      {s.name_cn && s.name && s.name !== s.name_cn && (
                        <p className="truncate text-xs text-zinc-400 light:text-zinc-500">
                          {s.name}
                        </p>
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
