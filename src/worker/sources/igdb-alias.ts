// Picking a Chinese title out of IGDB's alternative_names. Pure and dependency-
// free because BOTH sides need it: the browser (add-flow search results) and the
// Worker (recommendation candidates) — so it lives outside igdb.ts, whose token
// logic must stay out of the browser bundle.

/**
 * The first plausibly-Chinese name from a list of alternative names, or null.
 * A candidate must be predominantly Han and contain NO kana — kana means it's
 * the Japanese title, not Chinese (饿殍：明末千里行 ✓ vs 飢えた子羊 ✗). May be
 * Traditional; the browser normalizes to Simplified (OpenCC is browser-only).
 */
export function pickHanAlias(
  names: Array<string | null | undefined>,
): string | null {
  const candidates = names
    .map((s) => (s ?? "").trim())
    // ≥2 Han ideographs and NO kana.
    .filter(
      (s) => (s.match(/[㐀-鿿]/g) ?? []).length >= 2 && !/[぀-ヿ]/.test(s),
    );
  if (candidates.length === 0) return null;
  // Prefer the cleanest title — the shortest tends to be the bare name
  // (逸剑风云决) over a descriptive variant (逸剑风云决 (中日英韩文版) - …).
  return candidates.sort((a, b) => a.length - b.length)[0]!;
}
