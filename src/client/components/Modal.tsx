import { useEffect, useRef, type ReactNode } from "react";

import { useCloseOnBack } from "../hooks/useCloseOnBack";

// Shared overlay shell for every modal in the app. Owns the three close paths
// that were previously copy-pasted (and subtly wrong) in each modal:
//
//  1. Backdrop click — guarded, see below.
//  2. Escape — topmost overlay only, so Escape inside a nested editor closes
//     just that layer instead of the whole stack.
//  3. Browser back / mobile edge-swipe — via useCloseOnBack.
//
// The panel is a flex column with `overflow-hidden`, so callers pin a header
// and/or footer with `shrink-0` and give the scrolling region `flex-1
// overflow-y-auto`. Putting the scroll on the panel itself (what every modal
// used to do) scrolls the action buttons out of reach on tall forms.

// Escape is dispatched to the topmost overlay only. A module-level stack, not
// per-instance window listeners, is what makes "topmost" knowable.
const escapeStack: Array<{ close: () => void }> = [];
let escapeListenerInstalled = false;

function installEscapeListener(): void {
  if (escapeListenerInstalled) return;
  escapeListenerInstalled = true;

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const top = escapeStack[escapeStack.length - 1];
    if (top) top.close();
  });
}

interface ModalProps {
  onClose: () => void;
  /** Accessible name for the dialog. */
  ariaLabel: string;
  /** Tailwind max-width class for the panel, e.g. "max-w-sm". */
  maxWidth: string;
  /** Vertical placement: centred, or pinned near the top for tall list modals. */
  align?: "center" | "top";
  /** Tailwind max-height class for the panel. */
  maxHeight?: string;
  /**
   * Register the browser-back close path. Set false when an outer wrapper
   * already calls useCloseOnBack for this overlay (e.g. to cover a data-loading
   * gap before the panel mounts) — registering twice pushes two history entries
   * and costs the user two back gestures to dismiss one modal.
   */
  closeOnBack?: boolean;
  children: ReactNode;
}

export function Modal({
  onClose,
  ariaLabel,
  maxWidth,
  align = "center",
  maxHeight = "max-h-[85vh]",
  closeOnBack = true,
  children,
}: ModalProps) {
  // Mobile back-swipe (history back) closes the overlay instead of leaving the app.
  useCloseOnBack(onClose, closeOnBack);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    installEscapeListener();
    const entry = { close: () => onCloseRef.current() };
    escapeStack.push(entry);
    return () => {
      const i = escapeStack.indexOf(entry);
      if (i !== -1) escapeStack.splice(i, 1);
    };
  }, []);

  // Backdrop click closes — but ONLY when the gesture both started and ended on
  // the backdrop. Drag-selecting text inside the panel and releasing the mouse
  // outside it dispatches `click` on the nearest common ancestor of the press
  // and release targets, which is the backdrop; the panel is not in that
  // event's path, so a stopPropagation on the panel never runs and the modal
  // would close mid-selection, discarding the user's edits. Recording where the
  // press landed is what distinguishes a real dismissal from a stray release.
  const pressedOnBackdrop = useRef(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pressedOnBackdrop.current = e.target === e.currentTarget;
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const releasedOnBackdrop = e.target === e.currentTarget;
    if (pressedOnBackdrop.current && releasedOnBackdrop) onClose();
    pressedOnBackdrop.current = false;
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-black/50 p-4 ${
        align === "top" ? "items-start pt-16" : "items-center"
      }`}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      role="presentation"
    >
      <div
        className={`flex w-full ${maxWidth} ${maxHeight} flex-col overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-700 light:bg-white light:ring-zinc-200`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>
  );
}
