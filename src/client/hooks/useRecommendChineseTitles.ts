import { useEffect, useState } from "react";

import { lookupChineseTitleByTitles } from "../lib/enrich";
import { chineseLookupPlan, type Recommendation } from "../lib/recommend";

// Chinese titles for recommendation cards whose source ships none — AniList
// (no Chinese titles at all) and IGDB (alternative_names cover almost no
// long-tail games). Resolved from Bangumi like the library's enrich backfill,
// but display-only: nothing is persisted, the add flow stays untouched (the
// added row gets its real title_chinese from the add-time auto-fill).
// chineseLookupPlan decides per card what to search.
//
// Lookups run SEQUENTIALLY over the visible cards (gentle on Bangumi, same
// policy as useEnrichTitles) and fill in as they land; the card shows the
// native/English title until then. Results — including misses, so a title with
// no Bangumi match isn't retried every batch — are cached for the session.
const cache = new Map<string, string | null>();

const recKey = (rec: Recommendation) => `${rec.source}:${rec.id}`;

/**
 * Resolved Chinese titles for the given cards, keyed `${source}:${id}`,
 * growing as background lookups complete. Pass `enabled: false` (English UI)
 * to skip lookups entirely.
 */
export function useRecommendChineseTitles(
  recs: Recommendation[] | undefined,
  enabled: boolean,
): Record<string, string> {
  const [resolved, setResolved] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!enabled || !recs || recs.length === 0) return;
    let cancelled = false;

    void (async () => {
      for (const rec of recs) {
        const plan = chineseLookupPlan(rec);
        if (!plan) continue; // has a Chinese title already, or TMDB (already zh)
        const key = recKey(rec);

        if (!cache.has(key)) {
          let cn: string | null = null;
          try {
            cn = await lookupChineseTitleByTitles(plan.titles, plan.bgmType);
          } catch {
            cn = null; // Bangumi hiccup — the card keeps its native/English title
          }
          cache.set(key, cn);
        }

        if (cancelled) return;
        const cn = cache.get(key);
        if (cn) setResolved((m) => (m[key] ? m : { ...m, [key]: cn }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recs, enabled]);

  return resolved;
}
