// Browser-safe shim for `node:crypto` — only exposes the bits we need.
// Used via vite resolve.alias so frontend bundles don't choke on the Node import
// in `@mkg/shared/utils/id.ts`.
export function randomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback (RFC 4122 v4) for very old browsers / jsdom in tests
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  if (bytes[6] !== undefined) bytes[6] = (bytes[6] & 0x0f) | 0x40;
  if (bytes[8] !== undefined) bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20, 32)
  );
}
