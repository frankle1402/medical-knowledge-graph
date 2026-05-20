import { useEffect, useState } from 'react';

/**
 * Returns a value that only updates after `delayMs` of stable input.
 *
 * Useful for "fire one network call when the user stops dragging" — the
 * SynonymMergePanel threshold slider used this to collapse 14+ requests per
 * drag down to 1 per pause.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
