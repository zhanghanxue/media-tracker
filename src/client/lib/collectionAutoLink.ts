// Collection auto-grouping for AniList adds. AniList models each season as a
// separate Media linked by SEQUEL / PREQUEL edges. When the user adds an anime
// whose sequel/prequel TV entry is ALREADY in the library, place the new entry
// in that neighbour's collection so seasons self-group instead of landing as a
// separate card. Manual placement (the editor's Collection panel) stays the
// fallback for franchises with no clean chain (e.g. Fate).
//
// Conservative on purpose:
//   • Only direct (one-hop) SEQUEL / PREQUEL edges.
//   • Only season-like neighbours (TV / TV_SHORT / ONA) — recap MOVIEs, OVAs and
//     SPIN_OFFs are excluded.
//   • No sort_order guessing — the collection orders by date until reordered.

import {
  getAniListRelations,
  type AniListRelationEdge,
} from "../../worker/sources/anilist";
import { createCollectionApi, setItemCollectionApi } from "./collections";
import type { MediaListResponse, MediaRow } from "./types";

const CHAIN_RELATIONS = new Set(["SEQUEL", "PREQUEL"]);
const SEASON_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);

export interface AniListLibraryEntry {
  id: number; // our media row id
  collection_id: string | null;
}

export type CollectionDecision =
  | { mode: "adopt"; collectionId: string } // join an already-placed neighbour's collection
  | { mode: "create"; neighborIds: number[] } // group the new entry with loose neighbours
  | null;

/**
 * Decide how to group a freshly-added anime given its AniList relation edges and
 * an index of the library's AniList rows. Pure. If any qualifying neighbour is
 * already in a collection, adopt it (so a third season joins the existing group);
 * otherwise, if there are loose neighbours, signal to create a new collection
 * spanning them + the new entry. No qualifying neighbour → null (leave loose).
 */
export function findCollectionFromRelations(
  edges: AniListRelationEdge[],
  library: Map<string, AniListLibraryEntry>,
): CollectionDecision {
  const neighbors: AniListLibraryEntry[] = [];
  for (const e of edges) {
    if (!CHAIN_RELATIONS.has(e.relationType)) continue;
    if (e.node.format && !SEASON_FORMATS.has(e.node.format)) continue;
    const entry = library.get(String(e.node.id));
    if (entry) neighbors.push(entry);
  }
  if (neighbors.length === 0) return null;

  const placed = neighbors.find((n) => n.collection_id);
  if (placed) return { mode: "adopt", collectionId: placed.collection_id! };
  return { mode: "create", neighborIds: neighbors.map((n) => n.id) };
}

export interface AutoLinkResult {
  linked: boolean;
  /** True when a brand-new collection was minted (vs. joining an existing one). */
  created?: boolean;
}

/** Fetch the AniList rows of the library as an external_id → entry index. */
async function fetchAniListLibraryIndex(): Promise<
  Map<string, AniListLibraryEntry>
> {
  const res = await fetch("/api/media?limit=5000");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { items } = (await res.json()) as MediaListResponse;
  const index = new Map<string, AniListLibraryEntry>();
  for (const row of items) {
    if (row.external_source === "anilist" && row.external_id) {
      index.set(row.external_id, { id: row.id, collection_id: row.collection_id });
    }
  }
  return index;
}

/**
 * After an AniList add, try to group the new row with a sequel/prequel that's
 * already in the library. Best-effort: any failure resolves to { linked: false }
 * — never blocks the add. Skips non-AniList rows and rows already placed.
 */
export async function autoLinkAniListSeries(
  added: MediaRow,
): Promise<AutoLinkResult> {
  if (added.external_source !== "anilist" || !added.external_id) {
    return { linked: false };
  }
  if (added.collection_id) return { linked: false }; // already placed
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
  const decision = findCollectionFromRelations(edges, library);
  if (!decision) return { linked: false };

  if (decision.mode === "adopt") {
    await setItemCollectionApi(added.id, decision.collectionId);
    return { linked: true, created: false };
  }

  // Create a new collection spanning the new entry + its loose neighbour(s).
  const collection = await createCollectionApi(null, null);
  for (const neighborId of decision.neighborIds) {
    await setItemCollectionApi(neighborId, collection.id);
  }
  await setItemCollectionApi(added.id, collection.id);
  return { linked: true, created: true };
}
