import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { uiLangFromI18n } from "../lib/displayTitle";
import { seriesDisplayName, type SeriesSummary } from "../lib/series";
import type { MediaListResponse, MediaRow } from "../lib/types";

// The list of existing series (id + display label + override + member count) for
// the editor's "link to series" picker. The label is derived per UI language
// (so it reads 进击的巨人 vs Attack on Titan), with a manual override taking
// precedence. Under the "media" prefix so add/edit/link invalidations refresh it.
export function useSeriesIndex(): SeriesSummary[] {
  const { i18n } = useTranslation();
  const lang = uiLangFromI18n(i18n.language);

  const { data } = useQuery({
    queryKey: ["media", "series-index"],
    queryFn: async (): Promise<MediaRow[]> => {
      const res = await fetch("/api/media?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { items } = (await res.json()) as MediaListResponse;
      return items;
    },
    staleTime: 30_000,
  });

  const items = data ?? [];
  const groups = new Map<string, MediaRow[]>();
  for (const r of items) {
    if (!r.series_id) continue;
    const arr = groups.get(r.series_id);
    if (arr) arr.push(r);
    else groups.set(r.series_id, [r]);
  }

  const summaries: SeriesSummary[] = [];
  for (const [id, members] of groups) {
    summaries.push({
      id,
      name: seriesDisplayName(members, lang),
      override: members.find((m) => m.series_name)?.series_name ?? null,
      count: members.length,
    });
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}
