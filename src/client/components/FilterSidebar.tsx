import { useTranslation } from "react-i18next";

import type { MediaFilters } from "../lib/api";
import { REGION_FACETS, STATUS_FACETS, TYPE_FACETS } from "../lib/facets";

export type FacetKey = "types" | "regions" | "statuses";

interface FilterSidebarProps {
  filters: MediaFilters;
  onToggle: (facet: FacetKey, value: string) => void;
  onClear: () => void;
}

interface CheckboxGroupProps {
  legendKey: string;
  labelPrefix: string;
  values: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
}

function CheckboxGroup({
  legendKey,
  labelPrefix,
  values,
  selected,
  onToggle,
}: CheckboxGroupProps) {
  const { t } = useTranslation();
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
            {t(`${labelPrefix}.${value}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// CSS-only responsive drawer: on < md the panel is hidden behind a toggle
// (a label + peer checkbox); on >= md it's always visible. No JS state.
export function FilterSidebar({ filters, onToggle, onClear }: FilterSidebarProps) {
  const { t } = useTranslation();
  const hasAny =
    filters.types.length +
      filters.regions.length +
      filters.statuses.length >
    0;

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
          values={REGION_FACETS}
          selected={filters.regions}
          onToggle={(v) => onToggle("regions", v)}
        />
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
