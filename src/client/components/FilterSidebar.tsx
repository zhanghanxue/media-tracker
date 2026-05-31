import { useTranslation } from "react-i18next";

import type { GenreFacet, MediaFilters } from "../lib/api";
import { REGION_FILTER_FACETS, STATUS_FACETS, TYPE_FACETS } from "../lib/facets";

export type FacetKey = "types" | "regions" | "statuses" | "genres";

interface FilterSidebarProps {
  filters: MediaFilters;
  // Dynamic genre options (server-computed, scoped to the selected types).
  genreFacets: GenreFacet[];
  onToggle: (facet: FacetKey, value: string) => void;
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
export function FilterSidebar({
  filters,
  genreFacets,
  onToggle,
  onClear,
}: FilterSidebarProps) {
  const { t } = useTranslation();
  const hasAny =
    filters.types.length +
      filters.regions.length +
      filters.statuses.length +
      filters.genres.length >
    0;
  // Show whatever's selected even if it dropped out of the current facet list
  // (e.g. you picked a genre, then narrowed the type filter) so it stays
  // un-checkable-away-able and visible.
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
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100 light:text-zinc-900">
            {t("filters.heading")}
          </h2>
          {hasAny && (
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
          legendKey="filters.type"
          labelPrefix="type"
          values={TYPE_FACETS}
          selected={filters.types}
          onToggle={(v) => onToggle("types", v)}
        />
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
      </aside>
    </>
  );
}
