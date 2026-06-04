import { useState } from "react";
import { useTranslation } from "react-i18next";

import { applyTheme, getInitialTheme, type Theme } from "../lib/theme";

// Sun when dark (click → light), moon when light (click → dark). The label
// describes the action for screen readers.
export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = t(theme === "dark" ? "theme.toLight" : "theme.toDark");

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      aria-label={label}
      title={label}
      className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 sm:px-3 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100"
    >
      {theme === "dark" ? "☀" : "🌙"}
    </button>
  );
}
