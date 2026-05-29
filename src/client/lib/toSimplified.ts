// Traditional → Simplified Chinese normalization, used at write-time so every
// `title_chinese` we persist is Simplified.
//
// Why this exists: Bangumi's `name_cn` is Traditional for some entries (e.g.
// "鬼滅之刃" with the traditional 滅), which silently breaks Simplified search —
// you'd type "鬼灭" and miss the stored "鬼滅" (different code points). DESIGN.md
// §7 flagged this exact case ("Simplified vs Traditional mismatch → fix via
// OpenCC at write-time"). One conversion fixes both display and search.
//
// OpenCC ships large per-conversion dictionaries, so we lazy-import it: the
// dictionary chunk is fetched the first time you enrich, never on initial page
// load. Runs in the browser (the enricher / add flow already calls Bangumi
// there), keeping OpenCC out of the Worker bundle entirely.

type Convert = (text: string) => string;

let converterPromise: Promise<Convert> | null = null;
// The resolved converter, cached for synchronous use once the chunk has loaded.
let converter: Convert | null = null;

// `from: "t"` (OpenCC-standard Traditional) → `to: "cn"` (Mainland Simplified).
// Char-level conversion — faithful to the title, no regional vocab rewriting.
async function getConverter(): Promise<Convert> {
  if (!converterPromise) {
    converterPromise = import("opencc-js").then((OpenCC) => {
      const c = OpenCC.Converter({ from: "t", to: "cn" });
      converter = c;
      return c;
    });
  }
  return converterPromise;
}

/** Kick off (and await) the one-time OpenCC chunk load. */
export async function ensureConverterLoaded(): Promise<void> {
  await getConverter();
}

/**
 * Convert Traditional Chinese to Simplified. Already-Simplified text passes
 * through unchanged. Empty / whitespace-only input is returned as-is (no point
 * loading the dictionary to convert nothing).
 */
export async function toSimplified(text: string): Promise<string> {
  if (!text.trim()) return text;
  const convert = await getConverter();
  return convert(text);
}

/**
 * Synchronous Traditional → Simplified for hot paths (the library-membership
 * hint, called per search-result render). Returns the converted text if the
 * OpenCC chunk is already loaded, else the input UNCHANGED — a graceful
 * degradation: callers that need it loaded should await ensureConverterLoaded()
 * first (the title index does, so by search time the converter is ready).
 */
export function toSimplifiedSync(text: string): string {
  return converter ? converter(text) : text;
}
