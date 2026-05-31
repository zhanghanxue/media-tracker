import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fetchMediaList, type MediaFilters } from "../lib/api";
import { uiLangFromI18n } from "../lib/displayTitle";
import { useCollections } from "../hooks/useCollections";
import { useCreateCollection } from "../hooks/useCollectionMutations";
import { childCollections, collectionName, directItems } from "../lib/collections";
import type { Collection } from "../lib/types";

// Unfiltered library so the picker can show each collection's DERIVED name (the
// auto-named ones would otherwise all read "(untitled)"). Same key shape the
// rest of the app uses → shared cache.
const ALL_FILTERS: MediaFilters = {
  types: [],
  regions: [],
  statuses: [],
  genres: [],
  q: "",
  sort: "date_updated",
};

// A searchable "pick an existing collection, or type a name to create one"
// control. Self-contained (fetches its own data). Calls onPick with the chosen
// (or freshly-created) collection id. Render it inside a bordered container.
export function CollectionPicker({
  excludeId = null,
  onPick,
}: {
  excludeId?: string | null;
  onPick: (collectionId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLangFromI18n(i18n.language);
  const { data: collections = [] } = useCollections();
  const { data: library } = useQuery({
    queryKey: ["media", ALL_FILTERS, null],
    queryFn: () => fetchMediaList(ALL_FILTERS),
  });
  const items = library?.items ?? [];
  const create = useCreateCollection();
  const [query, setQuery] = useState("");

  const labelOf = (c: Collection) =>
    collectionName(
      c,
      directItems(items, c.id),
      childCollections(collections, c.id).map((g) => g.name ?? ""),
      lang,
      t("collection.untitled"),
    );
  const q = query.trim().toLowerCase();
  const matches =
    q === ""
      ? []
      : collections.filter(
          (c) => c.id !== excludeId && labelOf(c).toLowerCase().includes(q),
        );
  const exactMatch = collections.some((c) => labelOf(c).toLowerCase() === q);

  const createAndPick = () => {
    create.mutate(
      { name: query.trim() || null, parentId: null },
      { onSuccess: (col) => onPick(col.id) },
    );
  };

  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-950/40 p-2 light:border-zinc-300 light:bg-white">
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("collection.searchPlaceholder")}
        className="mb-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm light:border-zinc-300 light:bg-white"
      />
      {/* Create is always available — typing a name creates a named collection;
          leaving it blank creates an auto-named one (it'll derive its name from
          whatever you put in it, and you can rename later). */}
      {!exactMatch && (
        <button
          type="button"
          onClick={createAndPick}
          disabled={create.isPending}
          className="mb-2 w-full rounded-md bg-blue-600 px-2 py-1.5 text-left text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          ＋{" "}
          {query.trim() !== ""
            ? t("collection.create", { name: query.trim() })
            : t("collection.createBlank")}
        </button>
      )}
      <ul className="max-h-44 space-y-1 overflow-y-auto">
        {q === "" && (
          <li className="p-1.5 text-xs text-zinc-500">{t("collection.searchHint")}</li>
        )}
        {matches.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c.id)}
              className="w-full truncate rounded p-1.5 text-left text-sm hover:bg-zinc-800 light:hover:bg-zinc-100"
            >
              {labelOf(c)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
