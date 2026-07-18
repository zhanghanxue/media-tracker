// Session-scoped "just added" ids, newest first. Module-level (not React
// state) so any mutation hook can record an add without provider plumbing
// through the modals; deliberately NOT persisted — a page refresh clears the
// pins, which is the intended "until the page is refreshed" behavior.
//
// Two stores share the mechanism: media row ids (number) and collection ids
// (string), so a just-created collection stays visible on the implicit Home
// view the same way a just-added item does.
//
// The snapshot array is stable between changes (same reference), as required
// by useSyncExternalStore.

import type { MediaRow } from "./types";

function createSessionStore<T>() {
  let ids: T[] = [];
  const listeners = new Set<() => void>();
  return {
    record(id: T): void {
      if (ids.includes(id)) return;
      ids = [id, ...ids];
      for (const cb of listeners) cb();
    },
    get(): T[] {
      return ids;
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    reset(): void {
      ids = [];
      for (const cb of listeners) cb();
    },
  };
}

const mediaAdds = createSessionStore<number>();
const collectionAdds = createSessionStore<string>();

/** Record a newly-added row id: prepend if absent (newest first). */
export function recordSessionAdd(id: number): void {
  mediaAdds.record(id);
}

export function getSessionAddedIds(): number[] {
  return mediaAdds.get();
}

export function subscribeSessionAdds(cb: () => void): () => void {
  return mediaAdds.subscribe(cb);
}

/** Record a newly-created collection id: prepend if absent (newest first). */
export function recordSessionCollectionAdd(id: string): void {
  collectionAdds.record(id);
}

export function getSessionAddedCollectionIds(): string[] {
  return collectionAdds.get();
}

export function subscribeSessionCollectionAdds(cb: () => void): () => void {
  return collectionAdds.subscribe(cb);
}

/** Test helper — clears both stores. */
export function resetSessionAdds(): void {
  mediaAdds.reset();
  collectionAdds.reset();
}

/**
 * The session-added rows to pin at the (implicit) Home view, in add order
 * (newest first). `ids` is the recorded add order; `rows` is their CURRENT
 * server state (fetched unscoped by id). A pin is dropped when its row is:
 *   - absent from `rows` — it was deleted; or
 *   - inside a collection now (`collection_id != null`) — it belongs under its
 *     collection card at Home, not loose at the root level.
 * Pure so the pin logic is unit-testable without React Query / the DOM.
 */
export function selectSessionPins(ids: number[], rows: MediaRow[]): MediaRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter(
      (row): row is MediaRow => row !== undefined && row.collection_id === null,
    );
}

/**
 * The distinct collections that session-added rows have since been moved INTO,
 * newest-move first. Counterpart to selectSessionPins: when a pin is dropped for
 * having a collection_id, that collection is surfaced at Home so the item stays
 * reachable — without this, moving a non-in-progress add into a pre-existing
 * (no-in-progress) collection would make it vanish from Home entirely.
 */
export function selectSessionMovedCollectionIds(
  ids: number[],
  rows: MediaRow[],
): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const cid = byId.get(id)?.collection_id;
    if (cid && !seen.has(cid)) {
      seen.add(cid);
      out.push(cid);
    }
  }
  return out;
}
