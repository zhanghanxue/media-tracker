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

// A grouping word left dangling at the END of a collection name. These say
// "this is a set of things" — which a collection card already says — so inside a
// name they are noise: "Stranger Things Season" wants to read "Stranger Things".
//
// Two ways one gets there:
//   • a source hands it over ("Rocky Series", "Alien (Series)");
//   • the client derives a name as the longest common prefix of the members, so
//     "…Season 1" + "…Season 2" leaves a bare "Season", and 第一季 + 第二季
//     leaves a bare 第 — an ordinal prefix with its ordinal sheared off, never a
//     real ending for a Chinese title.
//
// "Collection" is deliberately absent: TMDB's English franchise names genuinely
// end in it ("Rocky Collection") and that reads fine. A bare trailing 系列 is
// likewise left alone — unbracketed it is usually part of the name (蜀山系列).
const TRAILING_GROUPING_MARKER =
  /\s*[（(]?\s*(?:\b(?:seasons?|series)\b|第)\s*[）)]?\s*$/iu;

// Separators the marker leaves behind ("Stranger Things: Season" → a dangling
// colon). Same set the client's prefix derivation trims.
const TRAILING_SEPARATOR = /[\s:：·・/\-–—]+$/u;

/**
 * Drop trailing grouping words ("Season", "Seasons", "Series", a dangling 第)
 * and the separators they leave behind. Applied repeatedly so a name carrying
 * more than one ("Doctor Who: Series —") comes out clean.
 *
 * Returns the input unchanged when stripping would empty it, so a collection
 * whose members really are all called "Seasons" keeps a usable name.
 */
export function stripSeriesWords(name: string): string {
  const original = name.trim();
  let out = original;
  // Bounded rather than while(true): the equality check below already
  // terminates, this just makes that impossible to get wrong later.
  for (let i = 0; i < 4; i += 1) {
    const next = out
      .replace(TRAILING_SEPARATOR, "")
      .replace(TRAILING_GROUPING_MARKER, "")
      .replace(TRAILING_SEPARATOR, "")
      .trim();
    if (next === out) return out;
    if (next === "") return original;
    out = next;
  }
  return out;
}

/**
 * Trim a source-provided collection name for display: drop TMDB's trailing
 * （系列） marker, any trailing grouping word, and surrounding whitespace.
 * Returns null for an empty/blank input, and leaves the value untouched if
 * stripping would empty it.
 */
export function stripCollectionSuffix(name: string | null): string | null {
  if (name === null) return null;
  const trimmed = name.trim();
  if (trimmed === "") return null;
  const stripped = stripSeriesWords(trimmed.replace(TRAILING_SERIES_MARKER, ""));
  return stripped === "" ? trimmed : stripped;
}
