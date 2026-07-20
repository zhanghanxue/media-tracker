import { useCallback, useEffect, useRef, useState } from "react";

// Returns `value` delayed by `delayMs` of quiet, plus a `flush` that emits the
// latest value right away. Each change resets the timer (clearTimeout in the
// effect cleanup), so rapid typing only emits once it stops.
//
// `flush` is what makes Enter mean "search now": a debounce tuned long enough
// to stop mid-word searches would otherwise make a user who typed the full
// title sit and wait for a delay they know is pointless.
export function useDebouncedValue<T>(
  value: T,
  delayMs: number,
): [T, () => void] {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The flush callback is stable, so it reads the current value from a ref
  // rather than closing over a stale one.
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    timer.current = setTimeout(() => setDebounced(value), delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delayMs]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setDebounced(latest.current);
  }, []);

  return [debounced, flush];
}
