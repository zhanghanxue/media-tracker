import { useEffect, useState } from "react";

import { lookupChineseTitleByTitles } from "../lib/enrich";
import type { Recommendation } from "../lib/recommend";

// Chinese titles for AniList recommendation cards. AniList ships no Chinese
// titles, so (like the library's enrich backfill) we resolve them from Bangumi —
// but display-only: nothing is persisted, the add flow stays untouched (the
// added row gets its real title_chinese from the add-time auto-fill).
//
// Lookups run SEQUENTIALLY over the visible cards (gentle on Bangumi, same
// policy as useEnrichTitles) and fill in as they land; the card shows the
// native title until then. Results — including misses, so a title with no
// Bangumi match isn't retried every batch — are cached for the session.
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
        // Only AniList cards need this; the other sources ship Chinese already.
        if (rec.addRef.source !== "anilist" || rec.titleChinese) continue;
        const key = recKey(rec);

        if (!cache.has(key)) {
          const { title, type } = rec.addRef.media;
          let cn: string | null = null;
          try {
            cn = await lookupChineseTitleByTitles(
              {
                native: title.native,
                romaji: title.romaji,
                english: title.english,
              },
              type === "MANGA" ? 1 : 2,
            );
          } catch {
            cn = null; // Bangumi hiccup — the card keeps its native title
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
