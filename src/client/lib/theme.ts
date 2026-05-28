// Theme state lives on <html data-theme="...">, set pre-paint by the inline
// script in index.html (stored choice → OS preference → dark). These helpers
// let the toggle read the current value and flip it, persisting to localStorage.

export type Theme = "dark" | "light";

const STORAGE_KEY = "theme";

export function getInitialTheme(): Theme {
  // The inline script already resolved this onto the <html> element — trust it
  // so the React state matches what's painted.
  const fromDom = document.documentElement.getAttribute("data-theme");
  if (fromDom === "dark" || fromDom === "light") return fromDom;

  // Fallbacks (SSR/tests/edge cases where the inline script didn't run).
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode / storage disabled — theme still applies for this session.
  }
}
