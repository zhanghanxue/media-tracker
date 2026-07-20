import { useTranslation } from "react-i18next";

import type { GenreFacet, MediaFilters } from "../lib/api";
import { uiLangFromI18n } from "../lib/displayTitle";
import { genreLabel } from "../lib/genreLabel";
import {
  REGION_FACETS,
  REGION_UNSET,
  STATUS_FACETS,
  TYPE_FACETS,
} from "../lib/facets";
import { regionLabel } from "../lib/region";
import { ChipGroup } from "./Chips";

// Types are no longer checkbox facets — the sidebar drills INTO a type
// (level 1 = type list, level 2 = that type's region/genre/status facets).
export type FacetKey = "regions" | "statuses" | "genres";

interface FilterSidebarProps {
  filters: MediaFilters;
  // Dynamic facet options (server-computed, scoped to the selected type):
  // the type's genres, and the region slugs its rows actually store (so
  // free-text "Other…" regions show up as filter chips too).
  genreFacets: GenreFacet[];
  regionFacets: GenreFacet[];
  onToggle: (facet: FacetKey, value: string) => void;
  onSelectType: (type: string) => void;
  onBackToTypes: () => void;
  onClear: () => void;
}

// CSS-only responsive drawer: on < md the panel is hidden behind a toggle
// (a label + peer checkbox); on >= md it's always visible. No JS state.
//
// Two-level navigation, derived from filters.types (no separate view state to
// desync): no type selected → the type list; a type selected → that type's
// facet groups plus a back button.
export function FilterSidebar({
  filters,
  genreFacets,
  regionFacets,
  onToggle,
  onSelectType,
  onBackToTypes,
  onClear,
}: FilterSidebarProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLangFromI18n(i18n.language);
  const activeType = filters.types[0] ?? null;
  const hasFacets =
    filters.regions.length + filters.statuses.length + filters.genres.length > 0;

  // Picking a facet applies it immediately, so on mobile the open drawer is
  // then just covering the results it produced. Close it. The checkbox is
  // uncontrolled (no `checked` prop, no onChange), so React isn't managing it
  // and setting `.checked` directly is what drives the peer-checked CSS.
  // Inert on desktop, where the sidebar is always visible regardless.
  //
  // Deliberately NOT wired to type selection: that drills from the type list
  // into that type's facets, so the drawer has more to show, not less.
  const closeDrawer = () => {
    const checkbox = document.getElementById("filter-drawer");
    if (checkbox instanceof HTMLInputElement) checkbox.checked = false;
  };

  const toggleAndClose = (facet: FacetKey, value: string) => {
    onToggle(facet, value);
    closeDrawer();
  };

  // Show whatever's selected even if it dropped out of the current facet list
  // (e.g. you picked a genre, then the facet list refreshed) so it stays
  // visible and un-checkable-away-able.
  const genreCounts = new Map(genreFacets.map((g) => [g.value, g.count]));
  const genreValues = [
    ...new Set([...genreFacets.map((g) => g.value), ...filters.genres]),
  ];

  // Regions: the curated set always shows; any extra slug the library actually
  // stores (free-text "Other…" values like "poland") is appended before the
  // trailing `__unset__` bucket, plus any selected-but-now-absent value.
  const regionCounts = new Map(regionFacets.map((r) => [r.value, r.count]));
  const regionValues = [
    ...new Set([
      ...REGION_FACETS, // curated real regions first
      ...regionFacets.map((r) => r.value),
      ...filters.regions.filter((r) => r !== REGION_UNSET),
      REGION_UNSET, // the "no region set" bucket stays last
    ]),
  ];

  return (
    <>
      {/* The checkbox must stay a preceding SIBLING of the aside for
          `peer-checked` to work. Its label does not — <label htmlFor> reaches
          across the document — so the toggle itself lives in the sticky
          toolbar, where it's reachable while scrolled. */}
      <input id="filter-drawer" type="checkbox" className="peer hidden" />

      {/* Below md the open drawer is a FIXED panel hanging off the header, not
          an inline block. Inline would expand it here in DOM order — above the
          list — so opening it from the sticky toolbar while scrolled down would
          push the grid around with the panel itself off-screen above. From md
          up every one of those overrides is reset and it's the plain sidebar
          column again. */}
      <aside className="hidden shrink-0 space-y-6 peer-checked:fixed peer-checked:inset-x-0 peer-checked:top-14 peer-checked:z-20 peer-checked:block peer-checked:max-h-[50vh] peer-checked:overflow-y-auto peer-checked:border-b peer-checked:border-zinc-800 peer-checked:bg-zinc-950 peer-checked:p-4 light:peer-checked:border-zinc-200 light:peer-checked:bg-white md:static md:z-auto md:block md:max-h-none md:w-56 md:overflow-visible md:border-0 md:bg-transparent md:p-0 md:pt-4">
        {activeType === null ? (
          <>
            <h2 className="text-sm font-semibold text-zinc-100 light:text-zinc-900">
              {t("filters.type")}
            </h2>
            <nav className="space-y-1">
              {TYPE_FACETS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onSelectType(value)}
                  className="flex w-full items-center justify-between rounded-lg border border-transparent px-2.5 py-2 text-left text-sm text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-800/60 light:text-zinc-700 light:hover:border-zinc-200 light:hover:bg-zinc-100"
                >
                  {t(`type.${value}`)}
                  <span aria-hidden="true" className="text-zinc-500">
                    ›
                  </span>
                </button>
              ))}
            </nav>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onBackToTypes}
              className="text-sm text-blue-400 hover:underline light:text-blue-600"
            >
              ← {t("filters.allTypes")}
            </button>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100 light:text-zinc-900">
                {t(`type.${activeType}`)}
              </h2>
              {hasFacets && (
                <button
                  type="button"
                  onClick={onClear}
                  className="text-xs text-blue-400 hover:underline light:text-blue-600"
                >
                  {t("filters.clear")}
                </button>
              )}
            </div>

            <ChipGroup
              legend={t("filters.region")}
              options={regionValues.map((v) => ({
                value: v,
                label: regionLabel(t, v),
                count: regionCounts.get(v),
              }))}
              selected={filters.regions}
              onToggle={(v) => toggleAndClose("regions", v)}
            />
            {genreValues.length > 0 && (
              <ChipGroup
                legend={t("filters.genre")}
                options={genreValues.map((v) => ({
                  value: v,
                  // Stored values are canonical Chinese; English mode maps
                  // them to English labels (filtering still uses the value).
                  label: genreLabel(v, lang),
                  count: genreCounts.get(v),
                }))}
                selected={filters.genres}
                onToggle={(v) => toggleAndClose("genres", v)}
              />
            )}
            <ChipGroup
              legend={t("filters.status")}
              options={STATUS_FACETS.map((v) => ({
                value: v,
                label: t(`status.${v}`),
              }))}
              selected={filters.statuses}
              onToggle={(v) => toggleAndClose("statuses", v)}
            />
          </>
        )}
      </aside>
    </>
  );
}

// The drawer's toggle button, rendered separately from the drawer itself so it
// can sit in the sticky toolbar (below md; the sidebar is always visible above
// it). Driven purely by htmlFor → the peer checkbox inside FilterSidebar.
export function FilterDrawerToggle() {
  const { t } = useTranslation();
  return (
    <label
      htmlFor="filter-drawer"
      className="inline-flex shrink-0 cursor-pointer items-center rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100 md:hidden"
    >
      {t("filters.toggle")}
    </label>
  );
}
