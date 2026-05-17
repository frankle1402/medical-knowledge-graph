/**
 * Token storage abstraction. Centralised so tests can swap easily.
 */
const TOKEN_KEY = 'mkg.token';

export const tokenStorage = {
  get(): string | null {
    try {
      return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      globalThis.localStorage?.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore storage errors (e.g. SSR) */
    }
  },
  clear(): void {
    try {
      globalThis.localStorage?.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};
