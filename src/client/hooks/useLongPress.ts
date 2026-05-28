import { useRef } from "react";

// Fires `onLongPress` after `ms` of a sustained touch. Returns touch handlers
// to spread onto an element. (Right-click / contextmenu is handled separately
// by the consumer for the desktop equivalent.)
export function useLongPress(onLongPress: () => void, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return {
    onTouchStart: () => {
      clear();
      timer.current = setTimeout(onLongPress, ms);
    },
    onTouchEnd: clear,
    onTouchMove: clear,
    onTouchCancel: clear,
  };
}
