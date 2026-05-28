import { useEffect, useState } from "react";

// Returns `value` delayed by `delayMs` of quiet. Each change resets the timer
// (clearTimeout in the effect cleanup), so rapid typing only emits once it stops.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
