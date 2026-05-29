// Client helpers for series grouping. A series is just media rows sharing a
// `series_id`; `series_name` is denormalized onto each. Linking/moving/unlinking
// is a normal media PATCH (series_id + series_name); only a rename spans rows.

import type { MediaRow, UiLang } from "./types";
import { displayTitle } from "./displayTitle";

/** Mint a new grouping key for a brand-new series. */
export function newSeriesId(): string {
  return `series:${crypto.randomUUID()}`;
}

/** Rename a whole series via PATCH /api/series/:id. `name` null clears the override. */
export async function renameSeriesApi(
  seriesId: string,
  name: string | null,
): Promise<void> {
  const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Rename failed (HTTP ${res.status})`);
}

export interface SeriesSummary {
  id: string;
  name: string; // display label (override or per-language derived)
  override: string | null; // the stored manual override, if any (else auto)
  count: number;
}

// Derive a series' display name from its members' titles IN THE CURRENT LANGUAGE
// (the longest common prefix), so a group auto-localizes — 进击的巨人 in zh,
// Attack on Titan in en — without storing a per-language name. Falls back to the
// first member's title when there's no usable shared prefix (e.g. Fate → "Fate").
export function deriveSeriesName(members: MediaRow[], lang: UiLang): string {
  const titles = members
    .map((m) => displayTitle(m, lang).trim())
    .filter((t) => t.length > 0);
  if (titles.length === 0) return "";
  if (titles.length === 1) return titles[0]!;

  let prefix = titles[0]!;
  for (const t of titles.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < t.length && prefix[i] === t[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (prefix === "") break;
  }
  // Trim trailing separators/space left by a partial-word cut.
  prefix = prefix.replace(/[\s:：·・/\-–—]+$/u, "").trim();
  return prefix.length >= 1 ? prefix : titles[0]!;
}

// The name to SHOW for a series: the manual override (if any member carries a
// non-null series_name) wins; otherwise the per-language derived name.
export function seriesDisplayName(members: MediaRow[], lang: UiLang): string {
  const override = members.find((m) => m.series_name)?.series_name;
  return override ?? deriveSeriesName(members, lang);
}

/** Order members within a group: season_number asc (nulls last), then date_added. */
export function compareSeasons(a: MediaRow, b: MediaRow): number {
  const an = a.season_number;
  const bn = b.season_number;
  if (an != null && bn != null && an !== bn) return an - bn;
  if (an != null && bn == null) return -1;
  if (an == null && bn != null) return 1;
  return a.date_added < b.date_added ? -1 : a.date_added > b.date_added ? 1 : 0;
}
