import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

// Debounced search input. Keystrokes update local state immediately (responsive
// typing) but only propagate to the parent — and thus trigger a refetch — after
// 300ms of quiet. Syncs back down when the parent resets `value` (e.g. Clear all).
export function SearchBar({ value, onChange }: SearchBarProps) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    const id = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 300);
    return () => clearTimeout(id);
    // Debounce keyed on `local` only — re-running on `value`/`onChange` would
    // reset the timer on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <input
      type="search"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      placeholder={t("search.placeholder")}
      className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
    />
  );
}
