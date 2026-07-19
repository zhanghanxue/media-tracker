// Normalization for collection names coming from a metadata source.

// TMDB suffixes its localized collection names with a "（系列）" marker —
// "民国三部曲（系列）", "蜀山（系列）" — which just says "series". Inside a
// collection card that is redundant, so it comes off. Matches the full-width
// form TMDB actually returns plus the half-width variant, with optional
// surrounding whitespace, and ONLY at the end of the string.
//
// A bare trailing "系列" is left alone: without the brackets it is usually part
// of the name itself (蜀山系列), not a marker.
const TRAILING_SERIES_MARKER = /\s*[（(]\s*系列\s*[）)]\s*$/;

/**
 * Trim a source-provided collection name for display: drop TMDB's trailing
 * （系列） marker and surrounding whitespace. Returns null for an empty/blank
 * input, and leaves the value untouched if stripping would empty it.
 */
export function stripCollectionSuffix(name: string | null): string | null {
  if (name === null) return null;
  const trimmed = name.trim();
  if (trimmed === "") return null;
  const stripped = trimmed.replace(TRAILING_SERIES_MARKER, "").trim();
  return stripped === "" ? trimmed : stripped;
}
