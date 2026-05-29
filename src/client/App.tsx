import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AddMediaModal } from "./components/AddMediaModal";
import { EnrichChineseButton } from "./components/EnrichChineseButton";
import { FilterSidebar, type FacetKey } from "./components/FilterSidebar";
import { LanguageToggle } from "./components/LanguageToggle";
import { MediaList } from "./components/MediaList";
import { RefreshEpisodesButton } from "./components/RefreshEpisodesButton";
import { SearchBar } from "./components/SearchBar";
import { ThemeToggle } from "./components/ThemeToggle";
import type { MediaFilters } from "./lib/api";
import type { SortKey } from "./lib/api";

const EMPTY_FILTERS: MediaFilters = {
  types: [],
  regions: [],
  statuses: [],
  q: "",
  sort: "date_updated",
};

const SORT_OPTIONS: SortKey[] = ["date_updated", "date_added", "title"];

export function App() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<MediaFilters>(EMPTY_FILTERS);
  const [showAddModal, setShowAddModal] = useState(false);

  const toggleFacet = (facet: FacetKey, value: string) => {
    setFilters((prev) => {
      const next = new Set(prev[facet]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [facet]: [...next] };
    });
  };

  const setQuery = (q: string) => setFilters((prev) => ({ ...prev, q }));
  const setSort = (sort: SortKey) => setFilters((prev) => ({ ...prev, sort }));
  const clearAll = () => setFilters(EMPTY_FILTERS);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur light:border-zinc-200 light:bg-white/90">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <h1 className="text-lg font-semibold">{t("app.title")}</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              {t("add.button")}
            </button>
            <RefreshEpisodesButton />
            <EnrichChineseButton />
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-4 md:flex md:gap-6">
        <FilterSidebar
          filters={filters}
          onToggle={toggleFacet}
          onClear={clearAll}
        />
        <main className="mt-4 min-w-0 flex-1 md:mt-0">
          <div className="mb-4 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchBar value={filters.q} onChange={setQuery} />
            </div>
            <label className="flex shrink-0 items-center gap-1.5 text-sm text-zinc-400 light:text-zinc-500">
              <span className="hidden sm:inline">{t("sort.label")}</span>
              <select
                value={filters.sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label={t("sort.label")}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100 light:border-zinc-300 light:bg-white light:text-zinc-900"
              >
                {SORT_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {t(`sort.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <MediaList filters={filters} />
        </main>
      </div>

      {showAddModal && (
        <AddMediaModal onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}
