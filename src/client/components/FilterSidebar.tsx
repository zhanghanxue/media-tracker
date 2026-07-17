import { useTranslation } from "react-i18next";

import type { GenreFacet, MediaFilters } from "../lib/api";
import { REGION_FILTER_FACETS, STATUS_FACETS, TYPE_FACETS } from "../lib/facets";

// Types are no longer checkbox facets — the sidebar drills INTO a type
// (level 1 = type list, level 2 = that type's region/genre/status facets).
export type FacetKey = "regions" | "statuses" | "genres";

interface FilterSidebarProps {
  filters: MediaFilters;
  // Dynamic genre options (server-computed, scoped to the selected type).
  genreFacets: GenreFacet[];
  onToggle: (facet: FacetKey, value: string) => void;
  onSelectType: (type: string) => void;
  onBackToTypes: () => void;
  onClear: () => void;
}

interface CheckboxGroupProps {
  legendKey: string;
  values: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  // How to render each value's label. Facet enums use an i18n prefix
  // (`type.animation`); genres are source-native strings shown verbatim.
  labelPrefix?: string;
  renderLabel?: (value: string) => string;
}

function CheckboxGroup({
  legendKey,
  labelPrefix,
  renderLabel,
  values,
  selected,
  onToggle,
}: CheckboxGroupProps) {
  const { t } = useTranslation();
  const label = (value: string) =>
    renderLabel ? renderLabel(value) : t(`${labelPrefix}.${value}`);
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 light:text-zinc-500">
        {t(legendKey)}
      </legend>
      <div className="space-y-1.5">
        {values.map((value) => (
          <label
            key={value}
            className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200 light:text-zinc-700"
          >
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={() => onToggle(value)}
              className="h-4 w-4 accent-blue-500"
            />
            {label(value)}
          </label>
        ))}
      </div>
    </fieldset>
  );
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
  onToggle,
  onSelectType,
  onBackToTypes,
  onClear,
}: FilterSidebarProps) {
  const { t } = useTranslation();
  const activeType = filters.types[0] ?? null;
  const hasFacets =
    filters.regions.length + filters.statuses.length + filters.genres.length > 0;
  // Show whatever's selected even if it dropped out of the current facet list
  // (e.g. you picked a genre, then the facet list refreshed) so it stays
  // visible and un-checkable-away-able.
  const genreValues = [
    ...new Set([...genreFacets.map((g) => g.value), ...filters.genres]),
  ];

  return (
    <>
      <input id="filter-drawer" type="checkbox" className="peer hidden" />
      <label
        htmlFor="filter-drawer"
        className="mb-3 inline-flex cursor-pointer items-center rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100 md:hidden"
      >
        {t("filters.toggle")}
      </label>

      <aside className="hidden shrink-0 space-y-6 peer-checked:block md:block md:w-56">
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
                  className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800 light:text-zinc-700 light:hover:bg-zinc-100"
                >
                  {t(`type.${value}`)}
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

            <CheckboxGroup
              legendKey="filters.region"
              labelPrefix="region"
              values={REGION_FILTER_FACETS}
              selected={filters.regions}
              onToggle={(v) => onToggle("regions", v)}
            />
            {genreValues.length > 0 && (
              <CheckboxGroup
                legendKey="filters.genre"
                renderLabel={(v) => v}
                values={genreValues}
                selected={filters.genres}
                onToggle={(v) => onToggle("genres", v)}
              />
            )}
            <CheckboxGroup
              legendKey="filters.status"
              labelPrefix="status"
              values={STATUS_FACETS}
              selected={filters.statuses}
              onToggle={(v) => onToggle("statuses", v)}
            />
          </>
        )}
      </aside>
    </>
  );
}
