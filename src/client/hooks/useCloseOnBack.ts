import { useEffect, useRef } from "react";

// Close a mounted overlay (modal / editor) on browser back — which is what the
// mobile edge-swipe gesture dispatches on iOS Safari and Android Chrome. On
// mount the hook pushes one history entry; a back gesture pops it and we call
// onClose. Closing any other way (✕ button, Escape, save) consumes the pushed
// entry silently so dead entries don't pile up on the history stack.
//
// Overlays can nest (e.g. a CollectionEditor opened from inside the media
// detail editor), so each entry records its depth and a popstate only closes
// overlays ABOVE the entry it lands on — one back gesture per layer, and a
// multi-entry jump (long-press back) closes every layer it skips over.
//
// A single module-level popstate dispatcher (not per-instance listeners) owns
// the event handling: it needs a global view of the open overlays to survive
// StrictMode's dev double-mount, where the twin effect's cleanup queues a
// history.back() that would otherwise eat the freshly-opened overlay's entry.

interface OverlayHistoryState {
  overlayDepth?: number;
  [key: string]: unknown;
}

interface OverlayLayer {
  depth: number;
  closedByPop: boolean;
  close: () => void;
}

// Depth counter + registry of currently-open overlays.
let overlayDepth = 0;
const layers = new Set<OverlayLayer>();
// Set when WE call history.back() to consume our own entry — the resulting
// popstate is bookkeeping, not a user gesture, and must not close anything.
let suppressNextPop = false;
let dispatcherInstalled = false;

function stateDepth(state: unknown): number {
  return (state as OverlayHistoryState | null)?.overlayDepth ?? 0;
}

function installDispatcher(): void {
  if (dispatcherInstalled) return;
  dispatcherInstalled = true;

  window.addEventListener("popstate", (e: PopStateEvent) => {
    const target = stateDepth(e.state);

    if (suppressNextPop) {
      suppressNextPop = false;
      // Our own back() landed. If an overlay above the landing entry is still
      // mounted, the back() was queued by StrictMode's dev remount (cleanup of
      // the twin effect) and just ate a live overlay's entry — restore it.
      // After a real ✕-close the closed layer has deregistered, no layer sits
      // above the landing entry, and this is a no-op.
      const maxOpen = Math.max(0, ...[...layers].map((l) => l.depth));
      if (maxOpen > target) {
        const prior = (window.history.state ?? {}) as OverlayHistoryState;
        window.history.pushState({ ...prior, overlayDepth: maxOpen }, "");
      }
      return;
    }

    // A real back/forward gesture: close every overlay above the entry we
    // landed on, topmost first.
    const toClose = [...layers]
      .filter((l) => l.depth > target)
      .sort((a, b) => b.depth - a.depth);
    for (const layer of toClose) {
      layer.closedByPop = true;
      layer.close();
    }
  });
}

export function useCloseOnBack(onClose: () => void): void {
  // Ref so the dispatcher always sees the latest onClose without the effect
  // re-running (a re-run would push a duplicate history entry).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    installDispatcher();

    overlayDepth += 1;
    const layer: OverlayLayer = {
      depth: overlayDepth,
      closedByPop: false,
      close: () => onCloseRef.current(),
    };
    layers.add(layer);

    // One entry per overlay, carrying the previous entry's state along (the
    // drill-down's collectionId must survive underneath us) with our depth
    // stamped on top. Skip the push when the entry is already there — that's
    // StrictMode's dev remount re-running the effect before the twin cleanup's
    // queued history.back() has landed.
    const prior = (window.history.state ?? {}) as OverlayHistoryState;
    if (stateDepth(prior) < layer.depth) {
      window.history.pushState({ ...prior, overlayDepth: layer.depth }, "");
    }

    return () => {
      layers.delete(layer);
      overlayDepth -= 1;
      // Closed without a back gesture → consume the entry we pushed (it — or a
      // stacked-above twin already being torn down — is still the top entry).
      if (!layer.closedByPop && stateDepth(window.history.state) >= layer.depth) {
        suppressNextPop = true;
        window.history.back();
      }
    };
  }, []);
}
