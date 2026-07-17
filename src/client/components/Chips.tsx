// Pill-chip selection controls — the shared look for every type / region /
// genre / status picker (filter sidebar + detail editor), replacing the old
// native checkboxes and <select>s. Two flavors of the same visual:
//
//   • ChipGroup  — multi-select (filter facets); toggles values in a set.
//   • ChipSelect — single-select (editor fields); radio semantics.
//
// Both wrap; options carry a pre-resolved label (i18n happens at the caller,
// where the right key prefix is known) and an optional count badge.

export interface ChipOption {
  value: string;
  label: string;
  count?: number;
}

const CHIP_BASE =
  "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors select-none";
const CHIP_OFF =
  "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 " +
  "light:border-zinc-300 light:text-zinc-600 light:hover:border-zinc-400 light:hover:text-zinc-900";
const CHIP_ON = "border-blue-500 bg-blue-600 text-white hover:bg-blue-500";

function Chip({
  option,
  selected,
  onClick,
  radio = false,
}: {
  option: ChipOption;
  selected: boolean;
  onClick: () => void;
  radio?: boolean;
}) {
  return (
    <button
      type="button"
      role={radio ? "radio" : undefined}
      aria-checked={radio ? selected : undefined}
      aria-pressed={radio ? undefined : selected}
      onClick={onClick}
      className={`${CHIP_BASE} ${selected ? CHIP_ON : CHIP_OFF}`}
    >
      <span className="truncate">{option.label}</span>
      {option.count != null && (
        <span
          className={
            selected ? "text-blue-100/80" : "text-zinc-500 light:text-zinc-400"
          }
        >
          {option.count}
        </span>
      )}
    </button>
  );
}

/** Multi-select chip row: clicking a chip toggles its value. */
export function ChipGroup({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend?: string;
  options: ChipOption[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset>
      {legend && (
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 light:text-zinc-500">
          {legend}
        </legend>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Chip
            key={o.value}
            option={o}
            selected={selected.includes(o.value)}
            onClick={() => onToggle(o.value)}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** Single-select chip row: exactly one value active (radio semantics). */
export function ChipSelect({
  options,
  value,
  onChange,
}: {
  options: ChipOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => (
        <Chip
          key={o.value}
          option={o}
          selected={o.value === value}
          onClick={() => onChange(o.value)}
          radio
        />
      ))}
    </div>
  );
}
