import { useEffect, useState } from "react";

import { isPinyinReady, loadPinyin } from "../lib/pinyinSort";

/**
 * Loads pinyin-pro (dynamic import) when `enabled`, and re-renders once it's
 * ready. Used to gate the zh title-sort interleave: while false the grid keys
 * cards by a plain-lowercase fallback; when it flips true the grid re-renders
 * with real pinyin keys that match the server's paginated order.
 */
export function usePinyinReady(enabled: boolean): boolean {
  const [ready, setReady] = useState(isPinyinReady());
  useEffect(() => {
    if (!enabled || ready) return;
    let alive = true;
    void loadPinyin().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [enabled, ready]);
  return ready;
}
