// Series auto-grouping for AniList adds (Increment 3). AniList models each
// season as a separate Media linked by SEQUEL / PREQUEL edges. When the user
// adds an anime whose sequel/prequel TV entry is ALREADY in the library, link
// the new entry into that series so seasons self-group instead of landing as a
// separate card. Manual link (the editor's Series panel) stays the fallback for
// franchises with no clean chain (e.g. Fate, whose entries aren't SEQUEL-linked).
//
// Conservative on purpose:
//   • Only direct (one-hop) SEQUEL / PREQUEL edges — not the whole relation graph.
//   • Only season-like neighbours (TV / TV_SHORT / ONA) — recap MOVIEs, OVAs and
//     SPIN_OFFs are excluded (verified against AoT's relations: Season 2 is a TV
//     SEQUEL; the recap films / school-parody spin-off / OVA prequel are not).
//   • season_number is left null → the grouped card orders by date; the user
//     reorders with the ▲▼ arrows. We never guess a season index from titles.

import {
  getAniListRelations,
  type AniListRelationEdge,
} from "../../worker/sources/anilist";
import { newSeriesId } from "./series";
import type { MediaListResponse, MediaRow } from "./types";

const CHAIN_RELATIONS = new Set(["SEQUEL", "PREQUEL"]);
const SEASON_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);

export interface AniListLibraryEntry {
  id: number; // our media row id
  series_id: string | null;
}

export type SeriesDecision =
  | { mode: "adopt"; seriesId: string } // join an already-grouped neighbour's series
  | { mode: "create"; neighborIds: number[] } // group the new entry with ungrouped neighbours
  | null;

/**
 * Decide how to group a freshly-added anime given its AniList relation edges and
 * an index of the library's AniList rows (external_id → {row id, series_id}).
 * Pure — all I/O lives in autoLinkAniListSeries. If any qualifying neighbour is
 * already grouped, adopt its series (so a third season joins the existing group);
 * otherwise, if there are ungrouped neighbours, signal to create a new series
 * spanning them + the new entry. No qualifying neighbour → null (leave standalone).
 */
export function findSeriesFromRelations(
  edges: AniListRelationEdge[],
  library: Map<string, AniListLibraryEntry>,
): SeriesDecision {
  const neighbors: AniListLibraryEntry[] = [];
  for (const e of edges) {
    if (!CHAIN_RELATIONS.has(e.relationType)) continue;
    // format null (e.g. a not-yet-released sequel) is allowed; a known non-season
    // format (MOVIE / OVA / SPECIAL …) is excluded.
    if (e.node.format && !SEASON_FORMATS.has(e.node.format)) continue;
    const entry = library.get(String(e.node.id));
    if (entry) neighbors.push(entry);
  }
  if (neighbors.length === 0) return null;

  const grouped = neighbors.find((n) => n.series_id);
  if (grouped) return { mode: "adopt", seriesId: grouped.series_id! };
  return { mode: "create", neighborIds: neighbors.map((n) => n.id) };
}

export interface AutoLinkResult {
  linked: boolean;
  /** True when a brand-new series was minted (vs. joining an existing one). */
  created?: boolean;
}

/** Fetch the AniList rows of the library as an external_id → entry index. */
async function fetchAniListLibraryIndex(): Promise<
  Map<string, AniListLibraryEntry>
> {
  const res = await fetch("/api/media?limit=200");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { items } = (await res.json()) as MediaListResponse;
  const index = new Map<string, AniListLibraryEntry>();
  for (const row of items) {
    if (row.external_source === "anilist" && row.external_id) {
      index.set(row.external_id, { id: row.id, series_id: row.series_id });
    }
  }
  return index;
}

/** PATCH a single row's series_id (grouping only — touches no other field). */
async function patchSeriesId(id: number, seriesId: string): Promise<void> {
  const res = await fetch(`/api/media/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ series_id: seriesId }),
  });
  if (!res.ok) throw new Error(`Link failed (HTTP ${res.status})`);
}

/**
 * After an AniList add, try to group the new row with a sequel/prequel that's
 * already in the library. Best-effort: any failure (AniList unreachable, library
 * fetch error) resolves to { linked: false } — never blocks the add. Skips
 * non-AniList rows and rows that are already grouped (e.g. a 409 re-add).
 */
export async function autoLinkAniListSeries(
  added: MediaRow,
): Promise<AutoLinkResult> {
  if (added.external_source !== "anilist" || !added.external_id) {
    return { linked: false };
  }
  if (added.series_id) return { linked: false }; // already grouped
  const id = Number(added.external_id);
  if (!Number.isInteger(id)) return { linked: false };

  let edges: AniListRelationEdge[];
  try {
    edges = await getAniListRelations(id);
  } catch {
    return { linked: false }; // AniList hiccup — adding still succeeded
  }
  if (edges.length === 0) return { linked: false };

  const library = await fetchAniListLibraryIndex();
  const decision = findSeriesFromRelations(edges, library);
  if (!decision) return { linked: false };

  if (decision.mode === "adopt") {
    await patchSeriesId(added.id, decision.seriesId);
    return { linked: true, created: false };
  }

  // Create a new series spanning the new entry + its ungrouped neighbour(s).
  const seriesId = newSeriesId();
  for (const neighborId of decision.neighborIds) {
    await patchSeriesId(neighborId, seriesId);
  }
  await patchSeriesId(added.id, seriesId);
  return { linked: true, created: true };
}
