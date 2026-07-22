// Client helpers for the collection tree (migration 0005). A collection is a
// real row with a parent_id (nesting) that holds media items (collection_id)
// and/or other collections. The API calls hit /api/collections; the pure tree
// utilities build/slice the tree the drill-down UI renders.

import type { Collection, MediaRow, UiLang } from "./types";
import type { MediaStatus } from "../../worker/db/schema";
import type { CollectionRollup, CollectionRollupTitles } from "./api";
import { displayTitle } from "./displayTitle";
import { recordSessionCollectionAdd } from "./sessionAdds";

// --- API ------------------------------------------------------------------

export async function listCollectionsApi(): Promise<Collection[]> {
  const res = await fetch("/api/collections");
  if (!res.ok) throw new Error(`Failed to load collections (HTTP ${res.status})`);
  const { collections } = (await res.json()) as { collections: Collection[] };
  return collections;
}

export interface CollectionPatch {
  name?: string | null;
  name_zh?: string | null;
  cover_url?: string | null;
  parent_id?: string | null;
  sort_order?: number | null;
  // Subtree bulk item-fields (applied to every descendant item).
  region?: string | null;
  type?: string;
  genres?: string[] | null;
}

export async function createCollectionApi(
  name: string | null,
  parentId: string | null,
): Promise<Collection> {
  const res = await fetch("/api/collections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parent_id: parentId }),
  });
  if (!res.ok) throw new Error(`Create collection failed (HTTP ${res.status})`);
  const collection = (await res.json()) as Collection;
  recordSessionCollectionAdd(collection.id);
  return collection;
}

export async function updateCollectionApi(
  id: string,
  patch: CollectionPatch,
): Promise<void> {
  const res = await fetch(`/api/collections/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Update collection failed (HTTP ${res.status})`);
}

export async function deleteCollectionApi(id: string): Promise<void> {
  const res = await fetch(`/api/collections/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Delete collection failed (HTTP ${res.status})`);
}

/** Link an item into a collection (or null to make it loose) + optional order. */
export async function setItemCollectionApi(
  id: number,
  collectionId: string | null,
  sortOrder?: number | null,
): Promise<void> {
  const patch: Record<string, unknown> = { collection_id: collectionId };
  if (sortOrder !== undefined) patch.sort_order = sortOrder;
  const res = await fetch(`/api/media/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Move item failed (HTTP ${res.status})`);
}

// --- Pure tree utilities ---------------------------------------------------

/** Direct child collections of `parentId` (null = roots), in sibling order. */
export function childCollections(
  collections: Collection[],
  parentId: string | null,
): Collection[] {
  return collections
    .filter((c) => c.parent_id === parentId)
    .sort(compareCollections);
}

/** Items sitting DIRECTLY in `collectionId` (null = loose at root), in order. */
export function directItems(
  items: MediaRow[],
  collectionId: string | null,
): MediaRow[] {
  return items.filter((m) => m.collection_id === collectionId).sort(compareItems);
}

/** All collection ids in `rootId`'s subtree (incl. rootId), via parent links. */
export function subtreeCollectionIds(
  collections: Collection[],
  rootId: string,
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const c of collections) {
    if (!c.parent_id) continue;
    const arr = childrenOf.get(c.parent_id);
    if (arr) arr.push(c.id);
    else childrenOf.set(c.parent_id, [c.id]);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return out;
}

/** Every item anywhere under `rootId` (direct or in a descendant collection). */
export function subtreeItems(
  items: MediaRow[],
  collections: Collection[],
  rootId: string,
): MediaRow[] {
  const ids = subtreeCollectionIds(collections, rootId);
  return items.filter((m) => m.collection_id && ids.has(m.collection_id));
}

/**
 * The set of collection ids whose subtree contains at least one of `items`
 * (the collection itself or any ancestor of an item's collection). Used to keep
 * the tree organized under a filter: only show collection cards that actually
 * hold a matching item somewhere inside.
 */
export function collectionsWithItems(
  items: MediaRow[],
  collections: Collection[],
): Set<string> {
  const byId = new Map(collections.map((c) => [c.id, c]));
  const out = new Set<string>();
  for (const it of items) {
    let cur = it.collection_id ? byId.get(it.collection_id) : undefined;
    while (cur && !out.has(cur.id)) {
      out.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
  }
  return out;
}

/** Path of collections from root → `id` (for breadcrumbs). Empty if not found. */
export function collectionPath(
  collections: Collection[],
  id: string | null,
): Collection[] {
  if (!id) return [];
  const byId = new Map(collections.map((c) => [c.id, c]));
  const path: Collection[] = [];
  let cur = byId.get(id);
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    path.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return path;
}

/**
 * The best stored name for a language, or null when none is set. A zh UI prefers
 * name_zh and then falls back to `name`. Used for search matching and for
 * labelling a child collection when deriving its parent's name.
 *
 * This is the raw stored resolution only. The full display name (collectionName
 * / collectionNameFromSamples) layers a shared-prefix derivation on top: in zh,
 * a genuine Chinese prefix of the members beats the English `name` fallback.
 */
export function storedName(collection: Collection, lang: UiLang): string | null {
  if (lang === "zh") return collection.name_zh || collection.name || null;
  return collection.name || null;
}

/**
 * Resolve a collection's display name from its members' titles (already mapped
 * to the active language). The resolution order is:
 *   1. an explicit stored name for THIS language (name_zh in zh, name in en);
 *   2. zh only — a Chinese name derived from a *genuine shared prefix* of the
 *      members, preferred over the English `name`, so a franchise whose items
 *      share a zh prefix (开拓者…) reads in Chinese even when only an English
 *      name was typed. sharedPrefix returns "" for a lone member or no overlap,
 *      so an English-named group of unrelated zh titles keeps its English name
 *      rather than echoing one member;
 *   3. loose derivation (longest common prefix, echoing the first member when
 *      there is none) — the pre-name behavior for an unnamed group;
 *   4. the child collections' shared prefix, then the untitled fallback.
 */
function resolveName(
  collection: Collection,
  memberTitles: string[],
  childNames: string[],
  lang: UiLang,
  fallback: string,
): string {
  const explicit = lang === "zh" ? collection.name_zh : collection.name;
  if (explicit) return explicit;
  if (lang === "zh") {
    const prefix = sharedPrefix(memberTitles);
    if (prefix) return prefix;
    if (collection.name) return collection.name;
  }
  const fromItems = deriveName(memberTitles);
  if (fromItems) return fromItems;
  return deriveName(childNames) || fallback;
}

/**
 * The collection's display name in `lang`, derived from its direct items. See
 * resolveName for the full resolution order.
 */
export function collectionName(
  collection: Collection,
  itemsUnder: MediaRow[],
  childNames: string[],
  lang: UiLang,
  fallback: string,
): string {
  return resolveName(
    collection,
    itemsUnder.map((m) => displayTitle(m, lang)),
    childNames,
    lang,
    fallback,
  );
}

/** Cover to show for a collection: pinned override, else first item's cover. */
export function collectionCover(
  collection: Collection,
  itemsUnder: MediaRow[],
): string | null {
  if (collection.cover_url) return collection.cover_url;
  return itemsUnder.find((m) => m.cover_url)?.cover_url ?? null;
}

// --- Rollup-based derivation (drill-down without the whole library) --------
// These mirror collectionName/collectionCover and the card's status rollup, but
// source their inputs from the server's per-collection rollups + the (small)
// collection tree, so the client never needs every item to render a level.

/**
 * Roll a collection's whole subtree up from the rollups map: counts (for the
 * card badge) plus the subtree's newest activity (`latestUpdated`) and earliest
 * release (`earliestRelease`) — used to position the collection card among the
 * level's items when interleaving by the active sort.
 */
export function subtreeRollup(
  rollups: Map<string, CollectionRollup>,
  collections: Collection[],
  rootId: string,
): {
  count: number;
  completed: number;
  planned: number;
  inProgress: number;
  dropped: number;
  paused: number;
  games: number;
  latestUpdated: string | null;
  earliestRelease: string | null;
} {
  let count = 0;
  let completed = 0;
  let planned = 0;
  let inProgress = 0;
  let dropped = 0;
  let paused = 0;
  let games = 0;
  let latestUpdated: string | null = null;
  let earliestRelease: string | null = null;
  for (const id of subtreeCollectionIds(collections, rootId)) {
    const r = rollups.get(id);
    if (!r) continue;
    count += r.direct_count;
    completed += r.completed_count;
    planned += r.planned_count;
    inProgress += r.in_progress_count;
    dropped += r.dropped_count;
    paused += r.paused_count;
    games += r.game_count;
    if (r.latest_updated && (!latestUpdated || r.latest_updated > latestUpdated)) {
      latestUpdated = r.latest_updated; // newest wins (ISO datetimes sort lexically)
    }
    if (
      r.earliest_release &&
      (!earliestRelease || r.earliest_release < earliestRelease)
    ) {
      earliestRelease = r.earliest_release; // oldest release wins
    }
  }
  return {
    count,
    completed,
    planned,
    inProgress,
    dropped,
    paused,
    games,
    latestUpdated,
    earliestRelease,
  };
}

/**
 * A collection's rank for the status-priority sort: the best (lowest) status
 * present anywhere in its subtree, mirroring STATUS_SORT_PRIORITY on the
 * server. Empty collections rank with `planned` (they hold nothing actionable
 * yet, but shouldn't sink below completed work).
 */
export function subtreeStatusPriority(counts: {
  count: number;
  inProgress: number;
  planned: number;
  completed: number;
  dropped: number;
  paused: number;
}): number {
  if (counts.inProgress > 0) return 0;
  if (counts.planned > 0) return 1;
  if (counts.completed > 0) return 2;
  if (counts.dropped > 0) return 3;
  if (counts.paused > 0) return 4;
  return 1; // empty → treat as planned
}

/** Card status badge from subtree counts: all-done → completed, all-planned →
 *  planned, else in-progress (mirrors CollectionCard's old rollupStatus). */
export function rollupStatus(counts: {
  count: number;
  completed: number;
  planned: number;
}): MediaStatus {
  if (counts.count === 0) return "planned";
  if (counts.completed === counts.count) return "completed";
  if (counts.planned === counts.count) return "planned";
  return "in_progress";
}

/** A collection's display name from its rollup sample titles (instead of the
 *  full member list). Same resolution as collectionName — see resolveName. */
export function collectionNameFromSamples(
  collection: Collection,
  sampleTitles: CollectionRollupTitles[],
  childNames: string[],
  lang: UiLang,
  fallback: string,
): string {
  return resolveName(
    collection,
    sampleTitles.map((s) => displayTitle(s, lang)),
    childNames,
    lang,
    fallback,
  );
}

/** Cover for a collection: pinned override, else the rollup's sample cover. */
export function collectionCoverFromRollup(
  collection: Collection,
  rollup: CollectionRollup | undefined,
): string | null {
  if (collection.cover_url) return collection.cover_url;
  return rollup?.sample_cover ?? null;
}

/**
 * The shared leading prefix of 2+ titles, trimmed, or "" when they share none
 * (or there are fewer than two). Unlike deriveName it never echoes a lone
 * member — a "" result means "no real common name", so callers can fall back to
 * a stored name instead of guessing one from a single title.
 */
export function sharedPrefix(rawTitles: string[]): string {
  const titles = rawTitles.map((t) => t.trim()).filter((t) => t.length > 0);
  if (titles.length < 2) return "";
  let prefix = titles[0]!;
  for (const t of titles.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < t.length && prefix[i] === t[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (prefix === "") break;
  }
  return prefix.replace(/[\s:：·・/\-–—]+$/u, "").trim();
}

/** Longest common prefix of titles, trimmed; "" when none. (was deriveSeriesName) */
export function deriveName(rawTitles: string[]): string {
  const titles = rawTitles.map((t) => t.trim()).filter((t) => t.length > 0);
  if (titles.length === 0) return "";
  if (titles.length === 1) return titles[0]!;
  let prefix = titles[0]!;
  for (const t of titles.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < t.length && prefix[i] === t[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (prefix === "") break;
  }
  prefix = prefix.replace(/[\s:：·・/\-–—]+$/u, "").trim();
  return prefix.length >= 1 ? prefix : titles[0]!;
}

/** Order collections among siblings: sort_order asc (nulls last), then name. */
export function compareCollections(a: Collection, b: Collection): number {
  return compareSortOrder(a.sort_order, b.sort_order, () =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

/** Order items within a collection: sort_order asc (nulls last), then date. */
export function compareItems(a: MediaRow, b: MediaRow): number {
  return compareSortOrder(a.sort_order, b.sort_order, () =>
    a.date_added < b.date_added ? -1 : a.date_added > b.date_added ? 1 : 0,
  );
}

function compareSortOrder(
  an: number | null,
  bn: number | null,
  tieBreak: () => number,
): number {
  if (an != null && bn != null && an !== bn) return an - bn;
  if (an != null && bn == null) return -1;
  if (an == null && bn != null) return 1;
  return tieBreak();
}
