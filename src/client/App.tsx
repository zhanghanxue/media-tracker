import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { AddMediaModal } from "./components/AddMediaModal";
import { RecommendModal } from "./components/RecommendModal";
import { WhatsNewModal } from "./components/WhatsNewModal";
import { EnrichChineseButton } from "./components/EnrichChineseButton";
import {
  FilterDrawerToggle,
  FilterSidebar,
  type FacetKey,
} from "./components/FilterSidebar";
import { LanguageToggle } from "./components/LanguageToggle";
import { MediaList } from "./components/MediaList";
import { RefreshEpisodesButton } from "./components/RefreshEpisodesButton";
import { SearchBar } from "./components/SearchBar";
import { ThemeToggle } from "./components/ThemeToggle";
import { fetchMediaFacets, type MediaFilters } from "./lib/api";
import type { SortKey } from "./lib/api";

const EMPTY_FILTERS: MediaFilters = {
  types: [],
  regions: [],
  statuses: [],
  genres: [],
  q: "",
  sort: "status",
};

// Dropdown order (PRD-v2 Feature D adds the reverse directions). title_zh /
// title_zh_desc are NOT listed: the grid collates titles client-side by UI
// language anyway, so one "Title A–Z / Z–A" pair covers both languages.
const SORT_OPTIONS: SortKey[] = [
  "status",
  "date_updated",
  "date_added",
  "release_date",
  "release_date_desc",
  "title",
  "title_desc",
  "rating_desc",
  "rating_asc",
];

export function App() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<MediaFilters>(EMPTY_FILTERS);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRecommendModal, setShowRecommendModal] = useState(false);
  const [showWhatsNewModal, setShowWhatsNewModal] = useState(false);

  // Genre + region facet options, scoped to the selected types (so picking
  // type=game shows only game genres/regions). Only fetched once at least
  // one type is chosen — otherwise the genre list would be the whole library's
  // union, which is huge and mixes every type's genres together.
  const { data: facets } = useQuery({
    queryKey: ["facets", filters.types],
    queryFn: () => fetchMediaFacets(filters.types),
    enabled: filters.types.length > 0,
  });
  const genreFacets = facets?.genres ?? [];
  const regionFacets = facets?.regions ?? [];

  const toggleFacet = (facet: FacetKey, value: string) => {
    setFilters((prev) => {
      const next = new Set(prev[facet]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [facet]: [...next] };
    });
  };

  // Sidebar level 1 → 2: drill into ONE type. All type-scoped facets reset so
  // no stale cross-type region/genre/status lingers (a "game" RPG genre means
  // nothing under "movie"). Search + sort are kept.
  const selectType = (type: string) =>
    setFilters((prev) => ({
      ...prev,
      types: [type],
      regions: [],
      statuses: [],
      genres: [],
    }));
  // Back to level 1 (and, with nothing else active, back to the implicit
  // in-progress Home view).
  const backToTypes = () =>
    setFilters((prev) => ({
      ...prev,
      types: [],
      regions: [],
      statuses: [],
      genres: [],
    }));
  // "Clear all" inside a type: drop the facets, stay on the type.
  const clearFacets = () =>
    setFilters((prev) => ({ ...prev, regions: [], statuses: [], genres: [] }));

  const setQuery = (q: string) => setFilters((prev) => ({ ...prev, q }));
  const setSort = (sort: SortKey) => setFilters((prev) => ({ ...prev, sort }));

  return (
    <div className="min-h-full">
      {/* No border-b: the list's sticky toolbar always sits directly beneath
          this, so a divider here separates chrome from chrome. At scroll-top a
          16px gap (the container's py-4) left it floating as a stray line above
          the toolbar; once scrolled the toolbar pinned flush and it vanished.
          The chrome/content boundary is the toolbar's job, not the header's. */}
      <header className="sticky top-0 z-10 bg-zinc-950/90 backdrop-blur light:bg-white/90">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4">
          <h1 className="min-w-0 truncate text-lg font-semibold">{t("app.title")}</h1>
          {/* Every control is icon-only below sm (the text label is hidden) so the
              whole row fits a narrow phone; labels appear from sm up. */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              title={t("add.button")}
              aria-label={t("add.button")}
              className="rounded-md bg-blue-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-blue-500 sm:px-3"
            >
              <span aria-hidden="true">{t("add.icon")}</span>
              <span className="hidden sm:inline"> {t("add.button")}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowRecommendModal(true)}
              title={t("recommend.button")}
              aria-label={t("recommend.button")}
              className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800 sm:px-3 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100"
            >
              <span aria-hidden="true">{t("recommend.icon")}</span>
              <span className="hidden sm:inline"> {t("recommend.button")}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowWhatsNewModal(true)}
              title={t("whatsNew.label")}
              aria-label={t("whatsNew.label")}
              className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800 sm:px-3 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100"
            >
              <span aria-hidden="true">{t("whatsNew.icon")}</span>
              <span className="hidden sm:inline"> {t("whatsNew.label")}</span>
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
          genreFacets={genreFacets}
          regionFacets={regionFacets}
          onToggle={toggleFacet}
          onSelectType={selectType}
          onBackToTypes={backToTypes}
          onClear={clearFacets}
        />
        <main className="mt-4 min-w-0 flex-1 md:mt-0">
          {/* Handed to MediaList rather than rendered here, so it rides that
              component's existing sticky bar instead of becoming a second one. */}
          <MediaList
            filters={filters}
            toolbar={
              <div className="flex items-center gap-2">
                <FilterDrawerToggle />
                <div className="min-w-0 flex-1">
                  <SearchBar value={filters.q} onChange={setQuery} />
                </div>
                <label className="flex shrink-0 items-center gap-1.5 text-sm text-zinc-400 light:text-zinc-500">
                  <span className="hidden lg:inline">{t("sort.label")}</span>
                  <select
                    value={filters.sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    aria-label={t("sort.label")}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 light:border-zinc-300 light:bg-white light:text-zinc-900"
                  >
                    {SORT_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {t(`sort.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            }
          />
        </main>
      </div>

      {showAddModal && (
        <AddMediaModal onClose={() => setShowAddModal(false)} />
      )}

      {showRecommendModal && (
        <RecommendModal onClose={() => setShowRecommendModal(false)} />
      )}

      {showWhatsNewModal && (
        <WhatsNewModal onClose={() => setShowWhatsNewModal(false)} />
      )}
    </div>
  );
}
