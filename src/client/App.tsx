import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AddMediaModal } from "./components/AddMediaModal";
import { FilterSidebar, type FacetKey } from "./components/FilterSidebar";
import { LanguageToggle } from "./components/LanguageToggle";
import { MediaList } from "./components/MediaList";
import { SearchBar } from "./components/SearchBar";
import { ThemeToggle } from "./components/ThemeToggle";
import type { MediaFilters } from "./lib/api";

const EMPTY_FILTERS: MediaFilters = {
  types: [],
  regions: [],
  statuses: [],
  q: "",
};

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
        <main className="min-w-0 flex-1">
          <div className="mb-4">
            <SearchBar value={filters.q} onChange={setQuery} />
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
