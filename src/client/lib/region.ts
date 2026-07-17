// Helpers for the open-ended region column. The schema accepts any string
// (schema.ts § MediaRegion); the curated REGION_FACETS are just the common
// cases, and the editor's "Other…" free-text path stores anything else —
// e.g. "poland" for a CDPR game. These helpers keep such values consistent
// with the curated slug style and readable in the UI.

import type { TFunction } from "i18next";

/**
 * Normalize free-text region input to the stored slug style: trimmed,
 * lowercased, inner whitespace → underscores ("Hong Kong" → "hong_kong").
 * CJK input passes through unchanged ("波兰" stays "波兰").
 */
export function normalizeRegionSlug(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, "_");
}

/** "hong_kong" → "Hong Kong" — display fallback for slugs with no i18n key. */
export function humanizeRegion(slug: string): string {
  return slug
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Display label for any region value: the i18n key when curated
 * (`region.japan` → "Japan" / "日本"), humanized slug otherwise.
 */
export function regionLabel(t: TFunction, value: string): string {
  return t(`region.${value}`, humanizeRegion(value));
}
