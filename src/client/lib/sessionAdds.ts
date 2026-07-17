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
