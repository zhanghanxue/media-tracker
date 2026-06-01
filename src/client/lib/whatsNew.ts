// Feature A ("What's New" scanner) — browser orchestration. Mirrors refreshOngoing:
// the browser fetches the library once, then per source finds "you don't have this
// yet" items, paced + with progress, isolating per-item failures. Two sources:
//   • TMDB tv (drama / variety): group the library's `tv:ID:sN` season rows by
//     show, fetch the show's current seasons (Worker proxy), diff → missing seasons.
//   • AniList (animation): walk each anime's SEQUEL edges (browser-direct), flag
//     any whose AniList id isn't in the library.
// Dismissed suggestions (persisted) are filtered out. Movies / manga / games are
// out of scope for v2.0 (per the PRD).

import {
  getAniListRelations,
  getAniListDetail,
} from "../../worker/sources/anilist";
import {
  diffTmdbSeasons,
  findNewSequels,
  type SeasonInfo,
} from "../../worker/api/whats-new";
import { fetchTmdbSeasons } from "./tmdbSearch";
import type { AniListMedia } from "../../worker/sources/anilist";
import type { MediaListResponse, MediaRow } from "./types";

// A surfaced suggestion: a new season/sequel of a show already in the library.
export interface Suggestion {
  // Dismissal identity (matches the server's (source, external_id) key).
  source: "tmdb" | "anilist";
  externalId: string;
  kind: "new_season" | "sequel";
  // The library show this extends ("Frieren — sequel ‘…’ available").
  forTitle: string;
  // The new thing's own label ("Season 3", or the sequel's title).
  label: string;
  coverUrl: string | null;
  // What the Add button needs. TMDB: add that season of the show; AniList: POST
  // the fetched media object (mapped server-side, like the search→add flow).
  addRef:
    | { source: "tmdb"; showId: number; seasonNumber: number }
    | { source: "anilist"; media: AniListMedia };
}

// Which slice of the library to scan. "all" keeps the original whole-library
// behaviour; the others scan ONE section so the run is quicker and lighter on the
// sources (fewer seeds → fewer external calls). The coverable sections map to the
// scanner's two source paths: anime → AniList sequels; drama/variety → TMDB
// seasons. (Games aren't scanned — game sequels are out of scope for v2.0.)
export type ScanScope = "all" | "animation" | "drama" | "variety";

export interface ScanProgress {
  done: number;
  total: number;
}

export interface ScanResult {
  suggestions: Suggestion[];
  // Shows/anime checked (for the "checked N" summary).
  checked: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pacing between external calls. AniList (~90/min) is the tight one; TMDB is
// generous. 350ms keeps a full scan well under AniList's limit.
const PER_MS = 350;

function displayTitleOf(row: MediaRow): string {
  return (
    row.title_chinese ??
    row.title_english ??
    row.title_romaji ??
    row.title_native ??
    `#${row.id}`
  );
}

// "tv:1399:s2" → { showId: 1399, season: 2 }; null for non-season tv ids.
function parseTmdbSeasonRef(externalId: string): { showId: number; season: number } | null {
  const m = /^tv:(\d+):s(\d+)$/.exec(externalId);
  if (!m) return null;
  return { showId: Number(m[1]), season: Number(m[2]) };
}

function anilistIdOf(row: MediaRow): string | null {
  return row.external_source === "anilist" ? row.external_id : row.anilist_id;
}

/**
 * Scan the library for new seasons (TMDB) and sequels (AniList). `onProgress` is
 * called as each show/anime is checked. `dismissed` is the set of already-
 * dismissed `${source}:${externalId}` keys to filter out. Best-effort: a single
 * source hiccup drops that one show, never the whole scan.
 */
export async function scanWhatsNew(
  dismissed: Set<string>,
  onProgress?: (p: ScanProgress) => void,
  scope: ScanScope = "all",
): Promise<ScanResult> {
  const res = await fetch("/api/media?limit=5000");
  if (!res.ok) throw new Error(`Failed to load library (HTTP ${res.status})`);
  const { items } = (await res.json()) as MediaListResponse;

  // Which source paths this scope runs. Scoping to one section means we only seed
  // (and only fire external calls) for that section — the whole point of the
  // per-section buttons. TMDB covers drama + variety; AniList covers anime.
  const scanTmdb = scope === "all" || scope === "drama" || scope === "variety";
  const scanAniList = scope === "all" || scope === "animation";
  // When a single TMDB section is chosen, restrict the season-row types to it so
  // a "Drama" scan doesn't also pull in variety shows (and vice versa).
  const tmdbTypes =
    scope === "drama"
      ? new Set(["drama"])
      : scope === "variety"
        ? new Set(["variety"])
        : new Set(["drama", "variety"]);

  // --- TMDB: group season rows by show, remember which seasons are owned -------
  const tmdbShows = new Map<number, { owned: Set<number>; title: string }>();
  if (scanTmdb) {
    for (const row of items) {
      if (row.external_source !== "tmdb") continue;
      if (!tmdbTypes.has(row.type)) continue;
      if (row.status === "dropped") continue;
      const ref = parseTmdbSeasonRef(row.external_id ?? "");
      if (!ref) continue;
      const show = tmdbShows.get(ref.showId) ?? { owned: new Set(), title: displayTitleOf(row) };
      show.owned.add(ref.season);
      tmdbShows.set(ref.showId, show);
    }
  }

  // --- AniList: the anime seeds + the owned-id set for sequel exclusion --------
  // The owned-id set is built from the WHOLE library regardless of scope, so a
  // sequel you already own (under any type) is still excluded.
  const ownedAniListIds = new Set<string>();
  for (const row of items) {
    const aid = anilistIdOf(row);
    if (aid) ownedAniListIds.add(aid);
  }
  const animeSeeds = scanAniList
    ? items.filter(
        (r) =>
          r.type === "animation" &&
          r.status !== "dropped" &&
          anilistIdOf(r) !== null,
      )
    : [];

  const total = tmdbShows.size + animeSeeds.length;
  let done = 0;
  const tick = () => onProgress?.({ done: ++done, total });

  const suggestions: Suggestion[] = [];

  // TMDB season diffs.
  for (const [showId, show] of tmdbShows) {
    try {
      const seasons: SeasonInfo[] = await fetchTmdbSeasons(showId);
      const missing = diffTmdbSeasons([...show.owned], seasons);
      for (const s of missing) {
        const externalId = `tv:${showId}:s${s.season_number}`;
        if (dismissed.has(`tmdb:${externalId}`)) continue;
        suggestions.push({
          source: "tmdb",
          externalId,
          kind: "new_season",
          forTitle: show.title,
          label: s.name ?? `Season ${s.season_number}`,
          coverUrl: s.poster_path
            ? `https://image.tmdb.org/t/p/w500${s.poster_path}`
            : null,
          addRef: { source: "tmdb", showId, seasonNumber: s.season_number },
        });
      }
    } catch {
      // one show's seasons fetch failed — skip it, keep scanning
    }
    tick();
    await sleep(PER_MS);
  }

  // AniList sequel walks.
  for (const seed of animeSeeds) {
    const id = Number(anilistIdOf(seed));
    if (!Number.isFinite(id)) {
      tick();
      continue;
    }
    try {
      const edges = await getAniListRelations(id);
      const sequels = findNewSequels(edges, ownedAniListIds);
      for (const seq of sequels) {
        if (dismissed.has(`anilist:${seq.id}`)) continue;
        // Fetch the sequel's media so the Add button can POST it (and to get a
        // title/cover for the card). One extra call per genuinely-new sequel.
        let media: AniListMedia | null = null;
        try {
          media = await getAniListDetail(seq.id, "ANIME");
          await sleep(PER_MS);
        } catch {
          media = null;
        }
        if (!media) continue;
        suggestions.push({
          source: "anilist",
          externalId: String(seq.id),
          kind: "sequel",
          forTitle: displayTitleOf(seed),
          label: media.title.english ?? media.title.romaji ?? media.title.native ?? `#${seq.id}`,
          coverUrl: media.coverImage.extraLarge,
          addRef: { source: "anilist", media },
        });
      }
    } catch {
      // AniList hiccup for this seed — skip, keep scanning
    }
    tick();
    await sleep(PER_MS);
  }

  // De-dupe: two owned seasons of the same show, or two prequels pointing at the
  // same sequel, can surface the same candidate twice.
  const seen = new Set<string>();
  const deduped = suggestions.filter((s) => {
    const key = `${s.source}:${s.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { suggestions: deduped, checked: total };
}

export async function fetchDismissed(): Promise<Set<string>> {
  const res = await fetch("/api/suggestions/dismissed");
  if (!res.ok) return new Set();
  const { dismissed } = (await res.json()) as { dismissed: string[] };
  return new Set(dismissed);
}

export async function dismissSuggestion(s: Suggestion): Promise<void> {
  await fetch("/api/suggestions/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: s.source, external_id: s.externalId, kind: s.kind }),
  });
}
