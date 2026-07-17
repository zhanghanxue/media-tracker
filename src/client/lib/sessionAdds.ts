// Session-scoped "just added" ids, newest first. Module-level (not React
// state) so any mutation hook can record an add without provider plumbing
// through the modals; deliberately NOT persisted — a page refresh clears the
// pins, which is the intended "until the page is refreshed" behavior.
//
// The snapshot array is stable between changes (same reference), as required
// by useSyncExternalStore.

let ids: number[] = [];
const listeners = new Set<() => void>();

/** Record a newly-added row id: prepend if absent (newest first). */
export function recordSessionAdd(id: number): void {
  if (ids.includes(id)) return;
  ids = [id, ...ids];
  for (const cb of listeners) cb();
}

export function getSessionAddedIds(): number[] {
  return ids;
}

export function subscribeSessionAdds(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Test helper — clears the store. */
export function resetSessionAdds(): void {
  ids = [];
  for (const cb of listeners) cb();
}
