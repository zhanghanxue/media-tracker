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

// `from: "t"` (OpenCC-standard Traditional) → `to: "cn"` (Mainland Simplified).
// Char-level conversion — faithful to the title, no regional vocab rewriting.
async function getConverter(): Promise<Convert> {
  if (!converterPromise) {
    converterPromise = import("opencc-js").then((OpenCC) =>
      OpenCC.Converter({ from: "t", to: "cn" }),
    );
  }
  return converterPromise;
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
